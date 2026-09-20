# Changelog

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
