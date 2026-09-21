---
name: config-guides
description: Generate and run a one-time local browser configuration guide, or implement an OpenCLI setup command with @zevaier/config-guides. Use when the owner asks an agent to create a configuration page, complete configuration themselves, or add an OpenCLI site setup workflow.
---

# Config Guides

Use `@zevaier/config-guides` to collect ordinary settings and secrets in a loopback browser page. Select exactly one workflow from the request:

1. **One-time guide** — generate a guide description, start it in agent-safe mode, and wait while the owner completes the form.
2. **OpenCLI setup** — add a durable `opencli <site> setup` command to a plugin and reuse the saved configuration in normal commands.

This skill is self-contained. README is an entry point for humans, not a prerequisite for this skill.

## Shared contract

Before either workflow, read [references/protocol.md](references/protocol.md). It defines every supported description field and the security invariants.

- Require Node.js 22 or newer.
- Current distributable: `@zevaier/config-guides` 0.3.2 from the GitHub Release tarball named `zevaier-config-guides-0.3.2.tgz`.
- Put ordinary values in `form.schema.properties`; put credentials in `form.secrets`. Never ask the owner to paste a secret into chat, command arguments, source, or an agent-readable trace.
- Use a stable user-owned JSON path. Each declared field has exactly one UI control and one binding.
- Use `kind: "variant"` for mutually exclusive choices such as Basic/PAT/Bearer or local/WebDAV. Non-active branch values and secrets are deleted on save.
- Use only sanitized `help` HTML. Never generate scripts, forms, styles, images, iframes, SVG, inline event handlers, or non-HTTP(S) links.
- Preserve unrelated keys in an existing config. Do not print the object returned by `readConfig`; it may contain secrets.
- A JSON description cannot perform a real service connection. Real verification belongs in a trusted JS `verify({ config, signal })` adapter.

## Workflow 1: one-time guide

Read [references/one-time-guide.md](references/one-time-guide.md), then:

1. Inspect the target tool's documented configuration and existing local config shape. Ask only for missing non-secret decisions that materially change the result.
2. Create a narrowly scoped `*-config-guide.json` in the user's workspace. Validate that every field, UI control, binding, and target path agrees.
3. Start the guide with `config-guide --agent`; keep the terminal process alive. This mode opens the owner's browser without printing the bearer URL into agent output.
4. Tell the owner only that the local form is ready. Wait for the process to finish; do not fill or inspect secrets on their behalf.
5. Report `saved`, `cancelled`, or `timeout` and the target path. Do not read back or echo the saved configuration.

Completion criterion: the owner has saved or explicitly cancelled the guide, the process has exited, and no secret or session URL appeared in the response.

## Workflow 2: OpenCLI setup

Read [references/opencli-setup.md](references/opencli-setup.md), then:

1. Inspect the plugin's existing registry, build, config precedence, generated-JS, test, and version conventions.
2. Add the exact GitHub Release dependency and commit its lockfile. Place the guide JSON beside the command module so `new URL('./config-guide.json', import.meta.url)` is stable across working directories.
3. Register one `setup` command under the plugin's existing site. Call `runGuide`; do not create a second config system.
4. Refactor normal commands and the verifier to share one candidate-config parser. The verifier must use the passed candidate, honor `signal`, perform a harmless real request, and return a short non-secret message.
5. Ensure an existing config is prefilled, secrets remain keep/replace/delete state, failed verification writes nothing, and successful save is consumed by subsequent plugin commands.
6. Build generated JavaScript when the repository commits it; run type checks, tests, description validation, and `opencli <site> setup --help`. Run the interactive setup only when the owner asks to configure the machine.

Completion criterion: the setup command is discoverable, the exact candidate is verified before save, runtime commands read the same file, tests cover failure/no-write and success, and repository version metadata is consistent.
