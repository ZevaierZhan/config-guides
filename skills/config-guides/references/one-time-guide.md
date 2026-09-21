# One-time local guide

Use this workflow when the owner wants the agent to generate the page and then personally complete configuration.

## Produce the description

Inspect the target tool's documented configuration names and existing file shape. Use a stable target path, normally `userHome` plus `.config/<tool>/config.json` or the tool's established user path. Prefer labels and help text that explain where a value comes from. Credentials always belong in `form.secrets`.

Minimal example:

```json
{
  "protocolVersion": "1.0",
  "plugin": { "id": "local/example", "title": "配置 Example" },
  "requires": ["file.json", "ui.secret"],
  "form": {
    "schema": {
      "type": "object",
      "properties": {
        "baseUrl": { "type": "string", "title": "服务地址", "minLength": 1 }
      },
      "required": ["baseUrl"],
      "additionalProperties": false
    },
    "secrets": {
      "token": { "label": "访问令牌", "required": true }
    },
    "ui": [
      { "kind": "field", "path": "/baseUrl", "widget": "url" },
      { "kind": "secret", "key": "token" }
    ]
  },
  "targets": {
    "config": {
      "kind": "file",
      "format": "json",
      "writeMode": "update-owned",
      "access": "user-only",
      "path": { "base": "userHome", "relative": ".config/example/config.json" },
      "allowPlaintextSecrets": true
    }
  },
  "bindings": [
    { "from": "/values/baseUrl", "target": "config", "to": "/connection/baseUrl" },
    { "from": "/secrets/token", "target": "config", "to": "/auth/token" }
  ],
  "submit": { "label": "保存 Example 配置", "apply": { "kind": "write-targets" } }
}
```

Validate JSON syntax and protocol consistency before launch. Use a workspace filename such as `.config-guides/example-config-guide.json`; keep it if the user wants a repeatable guide, otherwise ask before deleting it.

## Launch for the owner

Check `node --version` first. Then run in the foreground from a terminal tool and allow the process to remain active:

```sh
npx --yes --package=https://github.com/ZevaierZhan/config-guides/releases/download/v0.3.2/zevaier-config-guides-0.3.2.tgz config-guide --agent --spec /absolute/path/example-config-guide.json --timeout 30m
```

On Windows, quote an absolute path containing spaces. `--agent` opens the system browser and suppresses the bearer URL. Do not add `--no-open`. Tell the owner that the form is ready, then wait for the process.

Exit meanings:

- `0`: saved; report the path from final result JSON, without reading its contents.
- `2`: cancelled or timed out; report the reason.
- `1`: startup/description failure; fix non-secret errors and retry. If browser launch failed, ask the owner to run the same command interactively without `--agent` so only their terminal receives the URL.

The one-time CLI does not perform a remote connection check because JSON cannot contain executable adapters. If verification is required, use a small trusted JS host with `runGuide({ verify })` or implement the durable OpenCLI setup workflow.
