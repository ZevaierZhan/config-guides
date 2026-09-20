# 发布 @zevaier/config-guides@0.1.0

当前源码可以 npm pack，但尚未向任何远程 registry 发布。
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

```sh
npm login --registry=https://registry.npmjs.org/
npm run publish:npm
```

publish:npm 同时固定 registry 与 @zevaier:registry，避免用户已有的 scope 配置把包发错 registry。
脚本运行 npm publish --access=public，且 prepublishOnly 会重新运行测试。
按 npm 官方要求完成账户 2FA 或符合要求的发布凭据配置；不要把 Token 写到源码。
完成后用户才能正常安装：

```sh
npm install --save-exact @zevaier/config-guides@0.1.0
```

同名同版本不能用来覆盖旧内容；后续变更应递增版本。

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

同一份 `"@zevaier/config-guides":"0.1.0"` 依赖可以来自两个 registry，
但客户端 scope 配置决定具体来源。建议公开用户默认从 npmjs.org 安装。

## GitHub Actions

`.github/workflows/publish-github.yml` 仅由 workflow_dispatch 触发，不会 push 即发布。
在正确的拥有者/仓库中手动运行，使用 GITHUB_TOKEN，权限 packages:write。
先确认该仓库已关联或有权发布目标包；它不能跨命名空间自动获得发布权限。

没有配置 npm 自动发布工作流，以免暗中要求一个高权限 Token；npm 可以先人工 npm login/publish，
以后按官方文档选择 trusted publishing/OIDC 或其他认证。

## 原始资料（核对于 2026-09-20）

- https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry
- https://docs.npmjs.com/cli/v10/commands/npm-pack
