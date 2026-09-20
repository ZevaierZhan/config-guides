# Config guide protocol 1.0 — package 0.3.1

Use this reference when authoring or reviewing a guide description. `defineGuide` strictly rejects unknown or unsupported fields; this is a deliberate subset, not full JSON Schema.

## Root

```json
{
  "protocolVersion": "1.0",
  "plugin": { "id": "vendor/tool", "title": "配置 Tool" },
  "requires": ["file.json", "ui.secret"],
  "form": {},
  "targets": {},
  "bindings": [],
  "submit": { "label": "保存配置", "apply": { "kind": "write-targets" } }
}
```

- `protocolVersion`: exactly `"1.0"`.
- `plugin.id`, `plugin.title`: non-empty strings.
- `requires`: optional subset of `file.json`, `ui.secret`, `ui.variant`, `ui.sanitized-html`.
- Exactly one target is supported.

## Ordinary fields

`form.schema` must be an object schema with non-empty, single-level `properties` and `additionalProperties:false`.

Supported property keys:

- `type`: `string`, `number`, `integer`, or `boolean`.
- `title`, `description`: plain text.
- `default`, `enum`.
- `minLength`, `maxLength` for strings.
- `minimum`, `maximum` for numbers.

`required` contains ordinary property names. Integers must be JavaScript-safe integers. Unsupported JSON Schema keywords such as `pattern`, `format`, `$ref`, `oneOf`, or `if/then` are rejected.

## Secrets

```json
"secrets": {
  "token": {
    "label": "Access Token",
    "description": "Used by the API client.",
    "required": true
  }
}
```

Secrets have no default and are never returned to the browser. Existing secrets are represented only as keep/replace/delete state. A target containing secrets must set `allowPlaintextSecrets:true`; this is explicit acknowledgement that the JSON file contains plaintext credentials.

## UI controls

Every ordinary field and secret appears exactly once across the UI.

```json
{ "kind": "field", "path": "/baseUrl", "widget": "url" }
{ "kind": "secret", "key": "token" }
```

Widgets: `text`, `textarea`, `url`, `email`, `number`, `checkbox`, `select`. A select needs an `enum`; URL accepts only HTTP(S).

### Mutually exclusive variants

Use one required enum property as the discriminator. Cases must cover the enum exactly, cannot nest variants, and declare dynamic requirements as `/values/<field>` or `/secrets/<key>` references.

```json
{
  "kind": "variant",
  "path": "/authMode",
  "widget": "select",
  "inactive": "delete",
  "cases": [
    {
      "value": "basic",
      "label": "Basic",
      "controls": [
        { "kind": "field", "path": "/username", "widget": "text" },
        { "kind": "secret", "key": "password" }
      ],
      "required": ["/values/username", "/secrets/password"]
    },
    {
      "value": "pat",
      "label": "Personal Access Token",
      "controls": [{ "kind": "secret", "key": "pat" }],
      "required": ["/secrets/pat"]
    }
  ]
}
```

Branch-controlled fields must not also be globally required. The server rejects submitted inactive fields and deletes inactive saved values/secrets before verification and save.

### Sanitized rich help

Field, secret, and variant controls may include:

```json
"help": {
  "format": "html",
  "content": "<p>Create a <strong>token</strong>. <a href=\"https://docs.example/token\">Instructions</a></p>"
}
```

Allowed tags: `p`, `br`, `strong`, `em`, `code`, `pre`, `ul`, `ol`, `li`, `a`, `span`. Links must be absolute HTTP(S) URLs and are rewritten with `_blank` plus `noopener noreferrer`. Other tags, style/class/id/data attributes, inline events, unsafe URLs, forms, media, SVG, and scripts are removed.

## Target and bindings

```json
"targets": {
  "config": {
    "kind": "file",
    "format": "json",
    "writeMode": "update-owned",
    "access": "user-only",
    "path": {
      "base": "userHome",
      "relative": ".opencli/config/tool.json"
    },
    "allowPlaintextSecrets": true
  }
},
"bindings": [
  { "from": "/values/baseUrl", "target": "config", "to": "/connection/baseUrl" },
  { "from": "/secrets/token", "target": "config", "to": "/auth/token" }
]
```

Path bases:

- `userHome`: OS user home.
- `userConfigDir`: APPDATA on Windows, `~/Library/Application Support` on macOS, XDG config directory on Linux.
- `pluginDir`: guide file directory by default when using `specFile`.
- `workspaceDir`: caller must pass `context.workspaceDir`.

`relative` uses `/` and cannot contain traversal, absolute paths, drive syntax, backslashes, Windows device names, ADS, empty segments, or trailing dots/spaces.

Each field has one binding. `from` is `/values/<field>` or `/secrets/<key>`. `to` is a JSON Pointer. Destinations cannot overlap as parent/child. Saving preserves unbound keys and deletes omitted optional or inactive bound fields.

## Verification and lifecycle

Description JSON cannot run commands or connect to a service. A trusted JS host can pass:

```js
verify: async ({ config, signal }) => {
  const identity = await harmlessConnectionCheck(config, { signal });
  return { ok: true, message: `Connected as ${identity}` };
}
```

The test button verifies without writing. Save verifies the same submitted candidate again and writes only after success. The message and thrown errors must not contain credentials, authorization headers, or full sensitive responses.

Files are updated through revision checking, a cooperative lock, a same-directory private temporary file, fsync, and rename. The short-lived loopback URL contains a bearer credential and must not enter agent output, telemetry, chat, or public logs.

