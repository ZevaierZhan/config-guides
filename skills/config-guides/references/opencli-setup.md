# OpenCLI setup implementation

Use this workflow when adding `opencli <site> setup` to a plugin.

## Dependency and files

Until the package is published to npm, install the exact public release:

```sh
npm install --save-exact https://github.com/ZevaierZhan/config-guides/releases/download/v0.3.1/zevaier-config-guides-0.3.1.tgz
```

Commit the package manifest and lockfile according to the repository's package-manager convention. Place `config-guide.json` beside the command module. Ensure plugin packaging includes JSON and generated JavaScript files.

## Command adapter

```ts
import { cli, Strategy } from '@jackwener/opencli/registry';
import { runGuide } from '@zevaier/config-guides';
import { verifySetup } from './shared.js';

const guideFile = new URL('./config-guide.json', import.meta.url);

cli({
  site: 'example',
  name: 'setup',
  description: 'Open a local configuration page for Example',
  access: 'write',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['status', 'persistence', 'path', 'message'],
  func: async () => {
    const result = await runGuide({
      specFile: guideFile,
      closeAfterMs: 10_000,
      verification: { timeoutMs: 30_000 },
      verify: verifySetup,
    });
    return [{
      status: result.status,
      persistence: result.persistence,
      path: result.path,
      message: result.verificationMessage ?? result.reason ?? '',
    }];
  },
});
```

Use the existing site name and registry conventions. `browser:false` means the command uses the package's loopback page rather than an OpenCLI browser adapter.

## One parser for runtime and verification

Extract a candidate parser instead of reading process state inside every request:

```ts
type Candidate = Record<string, unknown>;

function configFrom(candidate: Candidate, env = process.env): ExampleConfig {
  // Candidate/config-file values first; legacy environment variables may remain as fallback.
  return validateAndNormalize(candidate, env);
}

export function readRuntimeConfig(): ExampleConfig {
  return configFrom(readPluginConfigFile(), process.env);
}

export async function verifySetup({ config, signal }: {
  config: Candidate;
  signal: AbortSignal;
}): Promise<{ ok: boolean; message: string }> {
  const parsed = configFrom(config, process.env);
  const identity = await fetchHarmlessIdentity(parsed, signal);
  return { ok: true, message: `Example connected as ${identity}` };
}
```

The verifier uses exactly the candidate supplied by config-guides, including kept existing secrets and deletion of inactive variant credentials. It must honor `signal`. Choose a harmless identity/status/read endpoint; do not create, update, publish, or delete external data. Authentication and response interpretation remain plugin responsibilities.

Avoid returning or throwing raw response bodies, credentials, URLs containing secrets, headers, cookies, or tokens. Convert failures into concise actionable messages.

## Config consumption

Normal commands must read the same target file that setup writes. Reuse `readConfig({ specFile: guideFile })` when asynchronous access fits, or keep the plugin's existing reader aligned with the guide bindings. Preserve explicit precedence: command arguments, saved plugin config, legacy environment variables, then defaults unless the plugin has a documented alternative.

`readConfig` can return plaintext secrets. Pass them only into the protocol client; never expose the full object in command rows, traces, errors, or model-visible output.

## Tests and delivery

Cover behavior through the public seams:

- `defineGuide` accepts the shipped JSON.
- Existing ordinary values are loaded and secrets remain state-only.
- Each variant shows one credential branch; inactive submitted fields are rejected and inactive saved credentials are pruned.
- `verifySetup` receives a supplied candidate and performs the expected harmless endpoint call.
- Failed verification leaves the file unchanged; successful verification saves.
- Runtime config parsing consumes the saved shape.
- `opencli <site> setup --help` discovers one command with no secret arguments.

Run the repository's build, typecheck, and test commands. If generated JavaScript is committed, rebuild it. Bump all plugin and monorepo manifest versions consistently. Commit/push only when requested or already part of the task.

