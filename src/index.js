import { ConfigGuideError, expect } from './errors.js';
import { ioError, keys } from './json.js';
import { loadSpec } from './spec.js';
import { loadSnapshot, readTarget, resolveTarget } from './storage.js';
import { launchBrowser } from './platform.js';
import { startSession } from './server.js';
export { ConfigGuideError } from './errors.js';
export { defineGuide, capabilities, version } from './spec.js';

function optionsCheck(options, extra = []) {
  keys(options, ['spec', 'specFile', 'context', ...extra], 'options', 'INVALID_OPTIONS');
}

/** Only starts a loopback server. No printing, browser opening, signal handlers or process.exit(). */
export async function createGuide(options) {
  optionsCheck(options, ['timeoutMs', 'closeAfterMs', 'signal']);
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1_000;
  const closeAfterMs = options.closeAfterMs ?? 10_000;
  expect(Number.isSafeInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 86_400_000, 'timeoutMs 需要在 50 到 86400000 之间', 'INVALID_OPTIONS');
  expect(Number.isSafeInteger(closeAfterMs) && closeAfterMs >= 0 && closeAfterMs <= 60_000, 'closeAfterMs 需要在 0 到 60000 之间', 'INVALID_OPTIONS');
  if (options.signal) {
    expect(typeof options.signal.addEventListener === 'function' && typeof options.signal.aborted === 'boolean', 'signal 必须是 AbortSignal', 'INVALID_OPTIONS');
    if (options.signal.aborted) throw new ConfigGuideError('ABORTED', '启动前已取消');
  }
  try {
    const { spec, context, specFile } = await loadSpec(options);
    const target = await resolveTarget(spec, context, specFile);
    const snapshot = await loadSnapshot(spec, target);
    return await startSession({ spec, target, snapshot, timeoutMs, closeAfterMs, signal: options.signal });
  } catch (error) { throw ioError(error, '无法启动配置引导工具'); }
}

/** High-level SDK: open a guide and await save/cancel/timeout without terminating the host. */
export async function runGuide(options) {
  optionsCheck(options, ['timeoutMs', 'closeAfterMs', 'signal', 'openBrowser', 'onReady', 'onWarning']);
  if (options.openBrowser !== undefined) expect(typeof options.openBrowser === 'boolean', 'openBrowser 必须是布尔值', 'INVALID_OPTIONS');
  for (const key of ['onReady', 'onWarning']) if (options[key] !== undefined) expect(typeof options[key] === 'function', `${key} 必须是函数`, 'INVALID_OPTIONS');
  const { openBrowser = true, onReady, onWarning, ...base } = options;
  const guide = await createGuide(base);
  try {
    if (onReady) await onReady({ url: guide.url, path: guide.path });
    else process.stderr.write(`配置引导工具：请在本机浏览器打开\n${guide.url}\n（完整链接是会话凭证，请勿转发。）\n`);
    let ended = false; guide.done.then(() => { ended = true; });
    await Promise.resolve(); // Let an already-completed session mark itself before opening a browser.
    if (openBrowser && !ended) {
      // Don't hold up the result while an external browser launcher is still exiting.
      const opening = launchBrowser(guide.url).catch(() => {
        if (ended) return;
        const message = '未能自动打开浏览器；请手动使用上面的本地地址。';
        try { if (onWarning) Promise.resolve(onWarning(message)).catch(() => {}); else process.stderr.write(`${message}\n`); } catch { /* diagnostics must not break a live session */ }
      });
      await Promise.race([opening, guide.done]);
    }
    return await guide.done;
  } catch (error) { await guide.close(); throw error; }
}

/** The same resolver used by the setup form. Does not create directories or write files. */
export async function getConfigPath(options) {
  optionsCheck(options);
  const { spec, context, specFile } = await loadSpec(options);
  return (await resolveTarget(spec, context, specFile)).path;
}

/** Explicit trusted-host API: returns the plugin's entire config, INCLUDING saved secrets.
 * Never log this result or return it wholesale to an agent. Missing config => undefined.
 */
export async function readConfig(options) {
  const filename = await getConfigPath(options);
  const { root, hash } = await readTarget(filename);
  return hash === 'missing' ? undefined : root;
}
