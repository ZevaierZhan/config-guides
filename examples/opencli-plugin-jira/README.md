# OpenCLI Jira setup 示例

这是配置能力示例，不是完整 Jira API 插件，也没有远端认证测试。
要求运行 OpenCLI 的 Node.js >=22。`@zevaier/config-guides` 本身不依赖 OpenCLI。

## 发布包后接入

把 `package.json` 的 dependencies 中加入：

```json
"@zevaier/config-guides": "0.1.0"
```

把 `jira-setup.ts`、`jira-guide.json` 放进你的插件，然后让 OpenCLI 安装该插件。
已安装插件也可以在插件目录先执行 `npm install`，再按你的 OpenCLI 版本重新转译/安装插件。
官方安装流程会安装常规依赖、链接宿主的 OpenCLI，并转译 TS 文件。
不要将独立 `npm install` 与“已经完成了 OpenCLI 的宿主链接/TS 转译”混淆。

执行：

```text
opencli jira setup
opencli jira config-status
```

本示例的 `package.json` 是独立示例插件清单。合入已有插件时应合并 dependencies，
不要用本示例覆盖你自己的整个 package.json。

`jira setup` 使用标准注册接口 `cli({site:'jira', name:'setup', browser:false, access:'write', func: ...})`。
`jira config-status` 使用相同 `jira-guide.json` 读取实际配置，不回显 Token。
如果已有同名 `jira/setup` 命令，应该替换原实现，而不是重复注册并依赖加载顺序。

## 发布前测试

先在隔离的临时插件目录安装本地 `.tgz`，再安装到你自己的 OpenCLI 开发环境。
本地 `.tgz` 安装会把 dependency 改成 `file:...`，测试结束后改回版本 `0.1.0`。
宿主完整安装需要网络；本交付环境未运行完整的 OpenCLI plugin install。

## 配置存放位置

`userHome + .opencli/config/jira.json`。这只是这个示例插件的约定，不是 OpenCLI 官方 Jira 规范。
访问令牌以明文 JSON 保存；私有文件权限不是加密。SDK 当前不接入钥匙串。

参考核对（2026-09-20）：
- https://github.com/jackwener/OpenCLI/blob/main/docs/guide/plugins.md
- https://github.com/jackwener/OpenCLI/blob/main/src/registry.ts
