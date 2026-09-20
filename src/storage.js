import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises';
import { ConfigGuideError, expect } from './errors.js';
import { isObject, MAX_BYTES, object, own, parseJSON, readLimited } from './json.js';
import { getAt, pointer, setAt } from './pointers.js';
import { secureEmptyFile } from './platform.js';

function configHome() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.env.XDG_CONFIG_HOME) {
    expect(path.isAbsolute(process.env.XDG_CONFIG_HOME), 'XDG_CONFIG_HOME 必须是绝对路径', 'INVALID_PATH');
    return process.env.XDG_CONFIG_HOME;
  }
  return path.join(os.homedir(), '.config');
}
async function canonicalizeBase(base) {
  // Resolve an alias at the base (e.g. macOS /var), including when .config does not exist yet.
  try { return await realpath(base); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const parent = path.dirname(base);
    if (parent === base) throw e;
    return path.join(await canonicalizeBase(parent), path.basename(base));
  }
}
export async function checkPath(base, target) {
  const relative = path.relative(base, target);
  expect(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), '目标超出基准目录', 'INVALID_PATH');
  let current = base;
  const parts = relative.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let info;
    try { info = await lstat(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    expect(!info.isSymbolicLink(), '拒绝基准目录以下的符号链接或 junction', 'UNSAFE_PATH');
    expect(i === parts.length - 1 ? info.isFile() : info.isDirectory(), '目标不是普通文件或父目录不是目录', 'INVALID_PATH');
    if (i === parts.length - 1) expect(info.nlink === 1, '拒绝硬链接配置文件', 'UNSAFE_PATH');
  }
}
export async function resolveTarget(spec, context, sourceFile) {
  const [id, target] = Object.entries(spec.targets)[0];
  let base = target.path.base === 'userHome' ? os.homedir()
    : target.path.base === 'userConfigDir' ? configHome() : context[target.path.base];
  expect(base && path.isAbsolute(base), `缺少绝对目录上下文: ${target.path.base}`, 'INVALID_PATH');
  if (['pluginDir', 'workspaceDir'].includes(target.path.base)) {
    expect((await stat(base)).isDirectory(), '插件/工作区基准必须是已有目录', 'INVALID_PATH');
  }
  base = await canonicalizeBase(base);
  const filename = path.join(base, ...target.path.relative.split('/'));
  await checkPath(base, filename);
  if (sourceFile) {
    const original = await realpath(sourceFile);
    const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
    expect(compare(original) !== compare(filename), '保存目标不能是配置引导描述文件本身', 'INVALID_PATH');
  }
  return { id, base, path: filename };
}
export async function readTarget(filename) {
  let info;
  try { info = await lstat(filename); } catch (e) { if (e.code === 'ENOENT') return { root: {}, hash: 'missing' }; throw e; }
  expect(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, '配置目标必须是非链接普通文件', 'UNSAFE_PATH');
  const data = await readLimited(filename);
  const root = parseJSON(data, 'INVALID_CONFIG');
  object(root, '已有配置', 'INVALID_CONFIG');
  return { root, hash: createHash('sha256').update(data).digest('hex') };
}
export async function loadSnapshot(spec, target) {
  const { root, hash } = await readTarget(target.path);
  const values = Object.create(null), savedSecrets = Object.create(null);
  for (const [key, prop] of Object.entries(spec.form.schema.properties)) if (own(prop, 'default')) values[key] = prop.default;
  for (const binding of spec.bindings) {
    const [kind, key] = pointer(binding.from);
    const entry = getAt(root, pointer(binding.to));
    if (!entry.exists) continue;
    if (kind === 'values') {
      expect(['string', 'number', 'boolean'].includes(typeof entry.value), '已有普通配置不是标量，请先修复配置文件', 'INVALID_CONFIG');
      values[key] = entry.value;
    } else {
      expect(typeof entry.value === 'string', '已有敏感字段不是文本', 'INVALID_CONFIG');
      savedSecrets[key] = entry.value;
    }
  }
  return { values, savedSecrets, hash };
}

/** Cooperative lock + revision check + same-directory temporary file + atomic rename.
 * Not a sandbox or a transaction against hostile processes running as this user.
 */
export async function saveTarget(spec, target, originalHash, values, secrets) {
  await checkPath(target.base, target.path);
  const dir = path.dirname(target.path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await checkPath(target.base, target.path);
  const lockPath = `${target.path}.config-guide.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    throw new ConfigGuideError('CONFIG_LOCKED', '配置被另一向导锁定；仅在确认无写入进程后清理残留 .config-guide.lock。', { cause });
  }
  let tempPath, temp, committed = false;
  const warnings = [];
  try {
    await lock.writeFile(String(process.pid)); await lock.close(); lock = undefined;
    const { root, hash } = await readTarget(target.path);
    expect(hash === originalHash, '配置已被其他进程修改，请取消并重新打开向导', 'CONFIG_CONFLICT');
    for (const binding of spec.bindings) {
      const [kind, key] = pointer(binding.from);
      const data = kind === 'values' ? values : secrets;
      setAt(root, pointer(binding.to), data[key], !own(data, key));
    }
    const data = Buffer.from(`${JSON.stringify(root, null, 2)}\n`, 'utf8');
    expect(data.length <= MAX_BYTES, '保存结果超过 2 MiB 限制', 'TOO_LARGE');
    tempPath = path.join(dir, `.config-guide-${randomBytes(16).toString('hex')}.tmp`);
    const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0);
    temp = await open(tempPath, flags, 0o600);
    await secureEmptyFile(tempPath);
    await temp.writeFile(data); await temp.sync(); await temp.close(); temp = undefined;
    await checkPath(target.base, target.path);
    expect((await readTarget(target.path)).hash === hash, '提交前检测到配置变化，请重新运行', 'CONFIG_CONFLICT');
    await rename(tempPath, target.path);
    committed = true; tempPath = undefined;
    // File fsync precedes rename. Directory fsync is best-effort on POSIX filesystems.
    if (process.platform !== 'win32') {
      let dirHandle;
      try { dirHandle = await open(dir, 'r'); await dirHandle.sync(); }
      catch { warnings.push('文件已保存，但目录同步未完成；断电持久性取决于文件系统。'); }
      finally { await dirHandle?.close().catch(() => {}); }
    }
  } finally {
    await temp?.close().catch(() => {});
    await lock?.close().catch(() => {});
    if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
    try { await rm(lockPath); }
    catch { if (committed) warnings.push('文件已保存，但协作锁清理失败；确认无其他会话后清理残留锁。'); }
  }
  return warnings;
}
