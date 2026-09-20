import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineGuide, createGuide, runGuide, readConfig, getConfigPath, version } from '../src/index.js';
import { validateSubmission } from '../src/spec.js';
import { pointer, setAt, getAt } from '../src/pointers.js';

const hello = JSON.parse(await readFile(new URL('../examples/hello-world.json', import.meta.url), 'utf8'));
async function fixture(t, edit = () => {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'config-guides-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spec = structuredClone(hello);
  spec.targets.config.path = { base: 'workspaceDir', relative: 'data/settings.json' };
  edit(spec);
  const options = { spec, context: { workspaceDir: dir } };
  return { dir, spec, options, target: path.join(dir, 'data', 'settings.json') };
}
async function start(t, options) {
  const session = await createGuide({ ...options, timeoutMs: 60_000 });
  t.after(() => session.close()); return session;
}
function api(session, route, body, headers = {}) {
  const url = new URL(session.url);
  const token = new URLSearchParams(url.hash.slice(1)).get('session');
  return fetch(`${url.origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { Origin: url.origin, 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const input = (name = 'Alice', message = 'Hello') => ({ values: { name, message }, secretUpdates: {} });
async function put(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value)); }
function withSecret(spec, required = false) {
  spec.form.secrets = { token: { label: 'Token', required } };
  spec.form.ui.push({ kind: 'secret', key: 'token' });
  spec.targets.config.allowPlaintextSecrets = true;
  spec.bindings.push({ from: '/secrets/token', target: 'config', to: '/auth/token' });
}

test('package exports and no host signal side effects', async () => {
  const before = process.listenerCount('SIGINT');
  const lib = await import('../src/index.js');
  assert.equal(lib.version, '0.1.0'); assert.equal(version, '0.1.0');
  assert.equal(process.listenerCount('SIGINT'), before);
});
test('original hello spec accepted without mutation', () => {
  const before = JSON.stringify(hello); const copy = defineGuide(hello);
  assert.deepEqual(copy.form.secrets, {}); assert.equal(JSON.stringify(hello), before);
});
test('strict schema, unsupported protocol and fields rejected', () => {
  for (const edit of [s => s.protocolVersion = '2.0', s => s.actions = {}, s => s.form.schema.properties.name.format = 'email',
    s => s.targets.config.format = 'yaml', s => s.requires = ['action.oauth'], s => s.submit.apply.kind = 'execute']) {
    const spec = structuredClone(hello); edit(spec); assert.throws(() => defineGuide(spec), { code: 'INVALID_SPEC' });
  }
});
test('defaults, bounds, enum and UI types checked', () => {
  for (const edit of [s => s.form.schema.properties.name.default = 1, s => s.form.schema.properties.name.enum = ['A', 'A'],
    s => s.form.ui[0].widget = 'checkbox', s => s.form.schema.required.push('bad'), s => s.form.ui.push(s.form.ui[0]),
    s => s.form.schema.properties.name.minLength = -1]) {
    const spec = structuredClone(hello); edit(spec); assert.throws(() => defineGuide(spec));
  }
});
test('pointer escaping, ancestor conflicts, arrays and pollution protection', () => {
  assert.deepEqual(pointer('/x~1y/~0key'), ['x/y', '~key']);
  const obj = {}; setAt(obj, ['a', 'b'], 'v'); assert.deepEqual(getAt(obj, ['a', 'b']), { exists: true, value: 'v' });
  assert.throws(() => pointer('/__proto__/x')); assert.throws(() => pointer('/a~2'));
  assert.throws(() => setAt({ a: [] }, ['a', '0'], 1));
  const spec = structuredClone(hello); spec.bindings[1].to = '/profile'; assert.throws(() => defineGuide(spec));
  assert.equal({}.polluted, undefined);
});
test('reject non-JSON objects, huge/unsafe values and cyclic references', () => {
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => defineGuide(cyclic));
  for (const v of [new Date(), undefined, NaN, 9007199254740992]) {
    const spec = structuredClone(hello); spec.form.schema.properties.name.default = v; assert.throws(() => defineGuide(spec));
  }
});
test('portable path traversal and Windows special names rejected on every OS', () => {
  for (const relative of ['../oops', '/tmp/a', 'C:/x', 'a\\b', 'a/../b', 'x//y', 'x/CON.json', 'x/name:stream', 'x/a.', 'x/a ']) {
    const spec = structuredClone(hello); spec.targets.config.path.relative = relative;
    assert.throws(() => defineGuide(spec), { code: 'INVALID_SPEC' });
  }
});
test('getConfigPath and readConfig share resolver; missing workspace fails', async t => {
  const f = await fixture(t); assert.equal(await getConfigPath(f.options), f.target);
  assert.equal(await readConfig(f.options), undefined);
  await assert.rejects(getConfigPath({ spec: f.spec }), { code: 'INVALID_PATH' });
});
test('spec file URL and UTF-8 BOM supported', async t => {
  const f = await fixture(t); const file = path.join(f.dir, 'guide.json');
  await writeFile(file, '\ufeff' + JSON.stringify(f.spec));
  const { pathToFileURL } = await import('node:url');
  assert.equal(await getConfigPath({ specFile: pathToFileURL(file), context: f.options.context }), f.target);
});
test('pluginDir defaults to spec file directory, not process cwd', async t => {
  const f = await fixture(t, s => { s.targets.config.path.base = 'pluginDir'; });
  const file = path.join(f.dir, 'guide.json'); await writeFile(file, JSON.stringify(f.spec));
  assert.equal(await getConfigPath({ specFile: file }), f.target);
});
test('save Unicode/nested mappings, independent file and user permissions', async t => {
  const f = await fixture(t); const session = await start(t, f.options);
  const model = await (await api(session, '/api/session')).json(); assert.equal(model.values.name, 'World'); assert.equal(model.closeAfterMs, 10_000);
  const res = await api(session, '/api/save', input('你好', 'Hello 世界🙂')); assert.equal(res.status, 200);
  const result = await session.done; assert.equal(result.persistence, 'saved'); assert.equal(result.verification, 'not-requested');
  assert.deepEqual(await readConfig(f.options), { profile: { name: '你好' }, message: 'Hello 世界🙂' });
  assert.equal(JSON.stringify(result).includes('你好'), false);
  if (process.platform !== 'win32') assert.equal((await stat(f.target)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(path.dirname(f.target)), ['settings.json']);
});
test('existing values override defaults and unowned fields survive', async t => {
  const f = await fixture(t); await put(f.target, { profile: { name: 'Before', extra: 9 }, message: 'old', untouched: true });
  const session = await start(t, f.options);
  const model = await (await api(session, '/api/session')).json(); assert.equal(model.values.name, 'Before');
  await api(session, '/api/save', input('After')); await session.done;
  assert.deepEqual(await readConfig(f.options), { profile: { name: 'After', extra: 9 }, message: 'Hello', untouched: true });
});
test('omitted optional ordinary fields delete only owned key', async t => {
  const f = await fixture(t, s => { s.form.schema.required = ['name']; });
  await put(f.target, { profile: { name: 'A' }, message: 'remove', extra: 'keep' });
  const session = await start(t, f.options);
  await api(session, '/api/save', { values: { name: 'B' } }); await session.done;
  assert.deepEqual(await readConfig(f.options), { profile: { name: 'B' }, extra: 'keep' });
});
test('validation errors keep session alive and do not create configuration', async t => {
  const f = await fixture(t); const s = await start(t, f.options);
  const bad = await api(s, '/api/save', input('', 9)); assert.equal(bad.status, 422);
  const error = await bad.json(); assert.ok(error.fields.name); assert.ok(error.fields.message);
  assert.equal(await readConfig(f.options), undefined);
  assert.equal((await api(s, '/api/session')).status, 200);
});
test('unknown submission fields, types and secret operations rejected', async t => {
  const f = await fixture(t, withSecret); const s = await start(t, f.options);
  for (const body of [{ values: { ...input().values, extra: 'X' } }, { values: [], secretUpdates: {} },
    { ...input(), extra: true }, { ...input(), secretUpdates: { token: { operation: 'keep', value: 'NEVER_ECHO' } } },
    { ...input(), secretUpdates: { token: { operation: 'replace' } } }]) {
    const res = await api(s, '/api/save', body); assert.equal(res.status, 400);
    assert.equal((await res.text()).includes('NEVER_ECHO'), false);
  }
});
test('HTTP assets and security headers, bearer token and origin protection', async t => {
  const f = await fixture(t); const s = await start(t, f.options); const url = new URL(s.url);
  const page = await fetch(url.origin); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /配置引导工具/);
  assert.equal((await fetch(`${url.origin}/api/session`)).status, 401);
  assert.equal((await api(s, '/api/session', undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await api(s, '/api/save', input(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await api(s, '/api/save', input(), { Origin: '' })).status, 403);
  assert.equal((await api(s, '/api/save', input(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await api(s, '/api/session', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await fetch(`${url.origin}/package.json`)).status, 404);
});
test('forged Host and arbitrary write endpoints rejected', async t => {
  const f = await fixture(t); const s = await start(t, f.options);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(s.url.split('#')[0], { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal((await api(s, '/api/exec', {})).status, 404);
});
test('oversized request fails without writing', async t => {
  const f = await fixture(t); const s = await start(t, f.options);
  const res = await api(s, '/api/save', input('A', 'x'.repeat(2 * 1024 * 1024))); assert.equal(res.status, 413);
  assert.equal(await readConfig(f.options), undefined);
});
test('malformed config and unsafe integer rejected, never overwritten', async t => {
  const f = await fixture(t); await mkdir(path.dirname(f.target), { recursive: true });
  for (const bad of ['not JSON', '[1,2]', 'null', '{"n":9007199254740993}']) {
    await writeFile(f.target, bad); await assert.rejects(createGuide(f.options)); assert.equal(await readFile(f.target, 'utf8'), bad);
  }
});
test('stale snapshot detects edit, preserving concurrent writer', async t => {
  const f = await fixture(t); const s = await start(t, f.options);
  await put(f.target, { newer: true });
  const response = await api(s, '/api/save', input()); assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CONFIG_CONFLICT');
  assert.deepEqual(await readConfig(f.options), { newer: true });
});
test('two sessions cannot silently overwrite each other', async t => {
  const f = await fixture(t); const a = await start(t, f.options), b = await start(t, f.options);
  await api(a, '/api/save', input('first')); await a.done;
  assert.equal((await api(b, '/api/save', input('second'))).status, 409);
  assert.equal((await readConfig(f.options)).profile.name, 'first');
});
test('cooperative lock fails closed and is not removed by another session', async t => {
  const f = await fixture(t); const s = await start(t, f.options); await mkdir(path.dirname(f.target), { recursive: true });
  const lock = f.target + '.config-guide.lock'; await writeFile(lock, 'external');
  const response = await api(s, '/api/save', input()); assert.equal((await response.json()).code, 'CONFIG_LOCKED');
  assert.equal(await readFile(lock, 'utf8'), 'external');
});
test('overlapping existing target structure is not destroyed', async t => {
  const f = await fixture(t); await put(f.target, { profile: 'do not destroy', message: 'old' });
  const s = await start(t, f.options); const response = await api(s, '/api/save', input());
  assert.equal((await response.json()).code, 'PATH_CONFLICT'); assert.equal((await readConfig(f.options)).profile, 'do not destroy');
});
test('secrets require explicit plaintext opt-in', () => {
  const spec = structuredClone(hello); withSecret(spec); delete spec.targets.config.allowPlaintextSecrets;
  assert.throws(() => defineGuide(spec), { code: 'INVALID_SPEC' });
});
test('secrets are not returned; keep/replace/delete semantics', async t => {
  const f = await fixture(t, withSecret); await put(f.target, { auth: { token: 'OLD_PRIVATE' }, extra: 1 });
  let s = await start(t, f.options);
  const modelText = await (await api(s, '/api/session')).text(); assert.equal(modelText.includes('OLD_PRIVATE'), false);
  assert.equal(JSON.parse(modelText).secretStates.token, true);
  await api(s, '/api/save', { ...input(), secretUpdates: { token: { operation: 'keep' } } });
  assert.equal(JSON.stringify(await s.done).includes('OLD_PRIVATE'), false);
  assert.equal((await readConfig(f.options)).auth.token, 'OLD_PRIVATE');
  s = await start(t, f.options);
  const res = await api(s, '/api/save', { ...input(), secretUpdates: { token: { operation: 'replace', value: 'NEW_PRIVATE' } } });
  assert.equal((await res.text()).includes('NEW_PRIVATE'), false); await s.done;
  assert.equal((await readConfig(f.options)).auth.token, 'NEW_PRIVATE');
  s = await start(t, f.options);
  await api(s, '/api/save', { ...input(), secretUpdates: { token: { operation: 'delete' } } }); await s.done;
  assert.equal(Object.hasOwn((await readConfig(f.options)).auth, 'token'), false);
});
test('required secret keep only works when a real saved value exists', async t => {
  const f = await fixture(t, s => withSecret(s, true)); const s = await start(t, f.options);
  const res = await api(s, '/api/save', input()); assert.equal(res.status, 422);
  assert.ok((await res.json()).fields['secret:token']);
});
test('symlink / junction target parent rejected', async t => {
  const f = await fixture(t); const outside = path.join(f.dir, 'outside'); await mkdir(outside);
  try { await symlink(outside, path.dirname(f.target), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (process.platform === 'win32' && e.code === 'EPERM') { t.skip('symlink privilege unavailable'); return; } throw e; }
  await assert.rejects(createGuide(f.options), { code: 'UNSAFE_PATH' });
});
test('cancel, idempotent close and timeout shut down service without files', async t => {
  const f = await fixture(t); const s = await start(t, f.options);
  await api(s, '/api/cancel', {}); const result = await s.done;
  assert.equal(result.status, 'cancelled'); assert.equal(result.persistence, 'unchanged');
  assert.deepEqual(await s.close(), result); assert.equal(await readConfig(f.options), undefined);
  await assert.rejects(fetch(s.url.split('#')[0]));
  const timed = await createGuide({ ...f.options, timeoutMs: 60 });
  assert.equal((await timed.done).reason, 'timeout');
});
test('AbortSignal and host API errors clean up', async t => {
  const f = await fixture(t); const controller = new AbortController();
  const session = await createGuide({ ...f.options, signal: controller.signal }); controller.abort();
  assert.equal((await session.done).reason, 'aborted');
  await assert.rejects(createGuide({ ...f.options, signal: controller.signal }), { code: 'ABORTED' });
  let url;
  await assert.rejects(runGuide({ ...f.options, openBrowser: false, onReady(ready) { url = ready.url; throw new Error('host failed'); } }), /host failed/);
  await assert.rejects(fetch(url.split('#')[0]));
});
test('runGuide direct import callback completes without process.exit or signal mutation', async t => {
  const f = await fixture(t); const before = process.listenerCount('SIGINT');
  const result = await runGuide({ ...f.options, openBrowser: false, onReady: async ready => {
    const response = await api(ready, '/api/save', input('SDK')); assert.equal(response.status, 200);
  } });
  assert.equal(result.status, 'completed'); assert.equal(process.listenerCount('SIGINT'), before);
  assert.equal((await readConfig(f.options)).profile.name, 'SDK');
});
test('integer, boolean and enum fields preserve types; non-http URL rejected', () => {
  const spec = defineGuide(hello);
  spec.form.schema.properties = { count: { type: 'integer', minimum: 0 }, enabled: { type: 'boolean' }, url: { type: 'string' }, color: { type: 'string', enum: ['a', 'b'] } };
  spec.form.schema.required = ['count', 'enabled'];
  spec.form.ui = [{ kind: 'field', path: '/url', widget: 'url' }];
  assert.deepEqual({ ...validateSubmission(spec, { values: { count: 0, enabled: false, url: 'https://example.com', color: 'a' } }, {}).values }, { count: 0, enabled: false, url: 'https://example.com', color: 'a' });
  assert.throws(() => validateSubmission(spec, { values: { count: 1.5, enabled: 'true', url: 'javascript:alert(1)' } }, {}), { code: 'VALIDATION_FAILED' });
});
test('CLI --version works and timeout returns code 2 with parseable stdout', async t => {
  const f = await fixture(t); const file = path.join(f.dir, 'guide.json'); await writeFile(file, JSON.stringify(f.spec));
  const bin = fileURLToPath(new URL('../bin/config-guide.js', import.meta.url));
  const child = spawn(process.execPath, [bin, '--spec', file, '--workspace-dir', f.dir, '--no-open', '--timeout', '100ms']);
  let out = '', err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 2); assert.equal(JSON.parse(out).reason, 'timeout'); assert.match(err, /127\.0\.0\.1/);
});

test('guide source file itself cannot be selected as output', async t => {
  const f = await fixture(t, s => { s.targets.config.path = { base: 'pluginDir', relative: 'guide.json' }; });
  const file = path.join(f.dir, 'guide.json'); await writeFile(file, JSON.stringify(f.spec));
  await assert.rejects(getConfigPath({ specFile: file }), { code: 'INVALID_PATH' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), f.spec);
});
test('public library rejects unknown options rather than silently dropping them', async t => {
  const f = await fixture(t);
  await assert.rejects(createGuide({ ...f.options, host: '0.0.0.0' }), { code: 'INVALID_OPTIONS' });
  await assert.rejects(runGuide({ ...f.options, openBrowser: 'false' }), { code: 'INVALID_OPTIONS' });
  await assert.rejects(createGuide({ ...f.options, closeAfterMs: -1 }), { code: 'INVALID_OPTIONS' });
  await assert.rejects(createGuide({ ...f.options, specFile: 'hello-world.json' }), { code: 'INVALID_OPTIONS' });
});
test('invalid UTF-8 source is rejected rather than replacing bytes', async t => {
  const f = await fixture(t); const file = path.join(f.dir, 'bad.json');
  await writeFile(file, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d]));
  await assert.rejects(getConfigPath({ specFile: file }), { code: 'INVALID_JSON' });
});
