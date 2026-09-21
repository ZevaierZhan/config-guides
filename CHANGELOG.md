# Changelog

## 0.3.2

- Replace the local setup page with a responsive anime-inspired visual theme.
- Keep all illustration assets embedded as Data URIs, with no external page requests.
- Distribute the package through a versioned public GitHub Release tarball; npm publication remains manual and paused.

## 0.3.1

- Add a self-contained Codex skill for one-time local guides and durable OpenCLI setup implementations.
- Add `config-guide --agent` to open the browser without printing the bearer session URL into agent output.
- Document one-sentence README entry prompts and ship skills in the package artifact.

## 0.3.0

- Add discriminated `ui.variant` branches with dynamic required fields and server-enforced deletion of inactive values and secrets.
- Add `ui.sanitized-html` help content with a strict element/attribute allowlist and HTTP(S)-only links.
- Render variant labels in select controls and keep inactive branch inputs out of browser submissions.

## 0.2.0

- Add host-provided real-connection verification through `verify({ config, signal })`.
- Add a browser "测试连接" action; saving re-verifies the exact candidate and writes only after success.
- Add bounded verification timeouts and safe, structured success/failure results.
- Explicitly report when an existing configuration was loaded; ordinary values are prefilled while secrets remain keep/replace/delete state only.

## 0.1.0

- JavaScript ESM implementation; reuses the caller's Node.js process, no Go executable.
- runGuide / createGuide / defineGuide / getConfigPath / readConfig APIs and TypeScript declarations.
- Backward-compatible subset of the previous Hello World JSON guide protocol.
- Local static UI, bearer token / Host / Origin protection, input validation.
- Single JSON target, secret keep/replace/delete, revision checks, private file replacement.
- CLI, Hello World and OpenCLI Jira setup / config-status examples.
- Saved pages count down for 10 seconds and then make a best-effort close attempt.
- Windows PowerShell adapters isolate PSModulePath so ACL modules load correctly under PowerShell 7 hosts.
- npm and GitHub Packages publication instructions; manual GitHub publish workflow.
