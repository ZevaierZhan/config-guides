// Copy into a clean project AFTER installing the .tgz, then run with Node.js.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runGuide, defineGuide, readConfig, version } from '@zevaier/config-guides';

assert.match(import.meta.resolve('@zevaier/config-guides'), /node_modules/);
const dir = await mkdtemp(path.join(tmpdir(), 'config-guide-consumer-'));
try {
  const spec = defineGuide({
    protocolVersion: '1.0', plugin: { id: 'pack-test', title: 'Packed package test' },
    form: { schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false }, ui: [{ kind: 'field', path: '/name', widget: 'text' }] },
    targets: { config: { kind: 'file', format: 'json', writeMode: 'update-owned', access: 'user-only', path: { base: 'workspaceDir', relative: 'settings.json' } } },
    bindings: [{ from: '/values/name', target: 'config', to: '/profile/name' }],
    submit: { label: 'Save', apply: { kind: 'write-targets' } },
  });
  const source = { spec, context: { workspaceDir: dir } };
  const result = await runGuide({ ...source, openBrowser: false, onReady: async ({ url }) => {
    const address = new URL(url);
    const token = new URLSearchParams(address.hash.slice(1)).get('session');
    const page = await fetch(address.origin); assert.equal(page.status, 200);
    assert.match(await page.text(), /配置引导工具/);
    const js = await fetch(`${address.origin}/app.js`); assert.equal(js.status, 200);
    const response = await fetch(`${address.origin}/api/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: address.origin, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ values: { name: 'Hello from installed npm package' } }),
    });
    assert.equal(response.status, 200);
  } });
  assert.equal(result.persistence, 'saved'); assert.equal(version, '0.3.1');
  assert.deepEqual(await readConfig(source), { profile: { name: 'Hello from installed npm package' } });
  console.log('PASS: installed .tgz -> ESM import -> shipped UI -> runGuide -> file save -> clean return');
} finally { await rm(dir, { recursive: true, force: true }); }
