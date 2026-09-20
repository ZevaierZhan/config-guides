// Developer optional: tsc --noEmit --strict --module NodeNext --target ES2022 tests/types.test.mts
import { runGuide, createGuide, defineGuide, readConfig, getConfigPath, type GuideResult } from '@zevaier/config-guides';
const guide = defineGuide({
  protocolVersion: '1.0', plugin: { id: 'types', title: 'Types' },
  form: { schema: { type: 'object', properties: { x: { type: 'string' } }, additionalProperties: false }, ui: [{ kind: 'field', path: '/x', widget: 'text' }] },
  targets: { config: { kind: 'file', format: 'json', writeMode: 'update-owned', access: 'user-only', path: { base: 'userHome', relative: '.example/config.json' } } },
  bindings: [{ from: '/values/x', target: 'config', to: '/nested/x' }], submit: { label: 'Save', apply: { kind: 'write-targets' } },
});
const result: Promise<GuideResult> = runGuide({ spec: guide, openBrowser: false, closeAfterMs: 10_000, onReady: async ({ url, path }) => { console.log(url, path); } });
void result;
void createGuide({ specFile: new URL('./guide.json', import.meta.url), signal: new AbortController().signal });
void readConfig({ spec: guide }); void getConfigPath({ spec: guide });
// @ts-expect-error Choose exactly one source.
void runGuide({ spec: guide, specFile: './x.json' });
// @ts-expect-error openBrowser must be boolean.
void runGuide({ spec: guide, openBrowser: 'yes' });
// @ts-expect-error Use a declared path base.
guide.targets.config.path.base = 'cwd';
