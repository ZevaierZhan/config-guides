# 发布 @zevaier/config-guides@0.3.1

当前源码可以 npm pack。npm 包首次创建前，需要一次性的发布凭据；创建后由 GitHub Actions
使用 npm Trusted Publishing（OIDC）发布，不再需要长期 npm 发布 Token。
不包含真实 Token、账号密码或远程登录操作。拥有 @zevaier 命名空间权限是发布前提。
GitHub 账号命名空间与 npm 账号命名空间相互独立，不能因一个存在就假设另一个已获得权限。

## 预检

```sh
node --version
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm pack --dry-run
npm pack
```

检查 `package.json` 的 name/version/repository/license。repository 当前预设为
`git+https://github.com/ZevaierZhan/config-guides.git`。
没有必要运行 npm build：源码本身就是可执行 ESM，网页已经是静态文件。
files 白名单只发布库、网页、类型、示例和文档，不发布 node_modules、测试运行目录或凭据。

## npmjs.org

### 首次创建包

npm 要求包先存在，才能为它配置 Trusted Publisher。推荐创建只允许发布
`@zevaier/config-guides` 的短期 granular access token，并在 GitHub 仓库
`Settings > Secrets and variables > Actions` 中临时添加名为 `NPM_TOKEN` 的 secret。

然后在 GitHub Actions 手动运行 `Publish npm`，输入已有 Release tag（例如 `v0.3.1`）。
工作流会 checkout 该 tag，核对 tag 与 `package.json` 版本，执行测试与 dry-run，再以
`--access public` 发布。首发成功后立即删除仓库的 `NPM_TOKEN` secret。

如果选择在本机首发，也可以：

```sh
npm login --registry=https://registry.npmjs.org/
npm run publish:npm
```

publish:npm 同时固定 registry 与 @zevaier:registry，避免用户已有的 scope 配置把包发错 registry。
脚本运行 npm publish --access=public，且 prepublishOnly 会重新运行测试。
按 npm 官方要求完成账户 2FA 或符合要求的发布凭据配置；不要把 Token 写到源码。
完成后用户才能正常安装：

```sh
npm install --save-exact @zevaier/config-guides@0.3.1
```

同名同版本不能用来覆盖旧内容；后续变更应递增版本。

### 后续使用 Trusted Publishing

首发完成后，打开 npmjs.com 上该包的 `Settings > Trusted Publisher`，选择 GitHub Actions，填写：

- Organization or user：`ZevaierZhan`
- Repository：`config-guides`
- Workflow filename：`publish-npm.yml`（只填文件名）
- Environment：留空
- Allowed actions：允许 `npm publish`

`.github/workflows/publish-npm.yml` 已声明 `id-token: write` 和 `contents: read`，使用
GitHub-hosted Ubuntu runner、Node 24，并固定从 tag 发布。创建新的 GitHub Release 后会自动发布；
也可用 `workflow_dispatch` 输入已有 tag 手动补发。未设置 `NPM_TOKEN` 时，npm CLI 会自动使用 OIDC，
公开仓库的公开包也会自动生成 provenance。

Trusted Publishing 要求 npm CLI >=11.5.1、Node >=22.14.0，工作流的 Node 24 满足要求。
不要在配置完成后继续保留可写的 `NPM_TOKEN`。

## GitHub Packages

本机交互登录：

```sh
npm login --scope=@zevaier --auth-type=legacy --registry=https://npm.pkg.github.com/
npm run publish:github
```

按提示输入 GitHub 用户名和有适当权限的 PAT classic。不要把它写入项目文件。
本机发布权限通常需要 write:packages；下载需要 read:packages，具体还受仓库/包权限限制。
新包默认私有，发布后在 GitHub 包设置中核对可见性；不要假设 --access public 会替你改变 GitHub 的包权限。

消费 GitHub Packages 的项目还需要 scope 路由，例如项目 .npmrc：

```ini
@zevaier:registry=https://npm.pkg.github.com
```

并通过本机 npm login 或安全的 CI secret 提供认证。GitHub 的 npm registry
即使对公开包，也要求认证。这与 npmjs.org 公共包的安装体验不同。
`docs/npmrc.github.example` 提供环境变量占位版本，**不是实际凭据文件**。
不要把 NODE_AUTH_TOKEN 的实际值提交到 Git。

同一份 `"@zevaier/config-guides":"0.3.1"` 依赖可以来自两个 registry，
但客户端 scope 配置决定具体来源。建议公开用户默认从 npmjs.org 安装。

## GitHub Actions

`.github/workflows/publish-github.yml` 仅由 workflow_dispatch 触发，不会 push 即发布。
在正确的拥有者/仓库中手动运行，使用 GITHUB_TOKEN，权限 packages:write。
先确认该仓库已关联或有权发布目标包；它不能跨命名空间自动获得发布权限。

`.github/workflows/publish-npm.yml` 在 GitHub Release 发布时自动执行，也支持手动选择已有 tag。
首发存在临时 `NPM_TOKEN` 时仅用于创建包；删除该 secret 并完成 npm Trusted Publisher 绑定后，
同一工作流自动改用 OIDC。工作流拒绝 tag 与 package version 不一致的发布。

## 原始资料（核对于 2026-09-20）

- https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/cli/v11/commands/npm-trust/
- https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry
- https://docs.npmjs.com/cli/v10/commands/npm-pack
