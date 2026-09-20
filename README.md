# @zevaier/config-guides · 0.3.0

**配置引导工具的 JavaScript 版。** 在 OpenCLI 插件的 `setup` 中直接 import，
启动回环地址随机端口网页，填写配置，保存后返回结构化结果。

真正使用 Node.js 的 HTTP/文件系统能力，不是包装 Go 可执行文件。
零第三方运行时依赖，无 install/postinstall 脚本，无前端构建步骤；含 TypeScript 声明。
使用 Node.js >=22。OpenCLI 插件可以复用**运行该插件的 Node.js 环境**；
这不表示任意封装版客户端都向插件提供兼容的 Node API，请核对宿主版本。

当前交付是源码和 `npm pack` 产物，**尚未由本次开发会话发布到 npm 或 GitHub Packages**。

## 1. 安装

发布到 npm 后：

```sh
npm install --save-exact @zevaier/config-guides@0.3.0
```

发布前可安装交付的本地 tarball：

```sh
npm install ./zevaier-config-guides-0.3.0.tgz
```

插件 `package.json` 中的依赖最终应为：

```json
{
  "type": "module",
  "dependencies": {
    "@zevaier/config-guides": "0.3.0"
  }
}
```

## 2. 最小 import

```js
import { runGuide } from '@zevaier/config-guides';

const result = await runGuide({
  specFile: new URL('./hello-world.json', import.meta.url),
});
console.log(result); // 只有状态/路径等，不包含用户配置或凭据。
```

`specFile` 接受字符串本地路径或 `file:` URL。使用相对 `import.meta.url` 的 URL
可以避免插件从不同 cwd 启动时找错 JSON。

也可直接传入 JS 对象，不需要生成临时 JSON：

```js
import { defineGuide, runGuide } from '@zevaier/config-guides';

const spec = defineGuide({
  protocolVersion: '1.0',
  plugin: { id: 'demo/hello', title: 'Hello World 配置' },
  form: {
    schema: {
      type: 'object',
      properties: { name: { type: 'string', title: '你的名字', default: 'World', minLength: 1 } },
      required: ['name'],
      additionalProperties: false,
    },
    ui: [{ kind: 'field', path: '/name', widget: 'text' }],
  },
  targets: {
    config: {
      kind: 'file', format: 'json', writeMode: 'update-owned', access: 'user-only',
      path: { base: 'userHome', relative: '.config/config-guide-demo/hello.json' },
    },
  },
  bindings: [{ from: '/values/name', target: 'config', to: '/profile/name' }],
  submit: { label: '保存配置', apply: { kind: 'write-targets' } },
});

await runGuide({ spec });
```

这段示例默认写入真实用户目录。自动测试应改用 `workspaceDir` 并传入临时目录。

## 3. 源码解压即可体验

```sh
node examples/hello.mjs
# 或
npm run demo
# 不自动打开浏览器
node bin/config-guide.js --spec examples/hello-world.json --no-open
```

运行源码前先执行 `npm install`；服务端使用 `sanitize-html` 清洗受限富文本。
前端静态资源位于 `web/`，作为 npm 包文件直接分发。

## 4. OpenCLI Jira setup

完整示例位于 `examples/opencli-plugin-jira/`，包含：

- `package.json`：依赖 `"@zevaier/config-guides": "0.3.0"`。
- `jira-setup.ts`：注册 `opencli jira setup`。
- `jira-guide.json`：文本、下拉框、密码及文件字段映射。
- `jira-config-status.ts`：共用路径解析读取配置，但不返回 Token。

互斥配置使用 `kind:"variant"`：判别字段选择一个 case，仅渲染并校验该分支；保存前服务端删除其他分支的普通字段和凭证。控件可通过 `help:{format:"html",content:"..."}` 显示受限富文本，HTML 会经过严格白名单清洗，链接只允许绝对 HTTP(S) 地址。

核心调用：

```ts
import { cli, Strategy } from '@jackwener/opencli/registry';
import { runGuide } from '@zevaier/config-guides';

cli({
  site: 'jira', name: 'setup', access: 'write',
  description: '在本地网页配置 Jira',
  strategy: Strategy.PUBLIC, browser: false,
  args: [], columns: ['status', 'path'],
  func: async () => {
    const result = await runGuide({
      specFile: new URL('./jira-guide.json', import.meta.url),
    });
    return [{ status: result.status, path: result.path }];
  },
});
```

完整示例另外使用 `AbortController` 处理 Ctrl+C。库不会自行退出 OpenCLI、改变 cwd、
修改全局环境变量，或安装全局 SIGINT/SIGTERM 监听器。
`browser:false` 表示不使用 OpenCLI 的浏览器扩展；SDK 自己打开默认浏览器中的本地页。

官方当前插件流程会安装普通 npm dependencies、链接宿主的 OpenCLI 并转译 TS。
示例依据官方接口编写；本次未安装完整 OpenCLI 验证端到端插件发现流程。
已有同名命令时替换原 setup，不要重复注册。

## 5. API

| API | 用途 |
|---|---|
| `defineGuide(spec)` | 立即校验描述，返回独立的规范化副本，不修改调用者对象 |
| `runGuide(options)` | 打开/展示本地 URL，等待保存、取消或超时后返回 |
| `createGuide(options)` | 仅启动服务，返回 `url / path / done / close()`，不打印、不打开浏览器 |
| `getConfigPath(source)` | 与 setup 完全共用的配置路径解析，不创建文件 |
| `readConfig(source)` | 显式读取配置；未配置返回 undefined；**可能含秘密，不可整对象输出** |

`source` 二选一：`{specFile}` 或 `{spec}`；可加 `context:{pluginDir,workspaceDir}`。
不能同时传 spec 和 specFile；路径不接受 HTTP URL。

`createGuide` 额外支持 `timeoutMs`（默认 15 分钟）、`closeAfterMs`（保存后默认 10 秒尝试关闭页面，设为 0 可禁用）、`signal`。
`runGuide` 还支持 `openBrowser`（默认 true）、`onReady({url,path})`、`onWarning(message)`。
参数与类型见 `types/index.d.ts`。

插件可提供真实连接验证 Adapter。向导用当前表单生成尚未落盘的完整候选配置；“测试连接”不会写文件，保存时会重新验证同一请求，只有成功后才原子写入：

```js
await runGuide({
  specFile: new URL('./jira-guide.json', import.meta.url),
  verification: { timeoutMs: 15_000 },
  verify: async ({ config, signal }) => {
    const identity = await connectToJira(config, { signal });
    return { ok: true, message: `Jira connected as ${identity}` };
  },
});
```

连接协议、认证组合和响应解释属于插件；config-guides 只负责候选配置、超时、取消、UI 和“验证后保存”。回调不得把密码、Token、请求头或完整敏感响应放进错误及返回消息。

```js
const session = await createGuide({ specFile: './hello-world.json' });
// 把 session.url 显示在自己的本地 UI；不要发到模型上下文或遥测服务。
const result = await session.done;
// 或 await session.close();
```

默认 `runGuide` 将短期会话 URL 输出到 stderr，stdout 保持干净。
`onReady` 提供时，由调用方负责展示 URL，默认提示不再输出。
该链接包含一次会话的访问凭证；不要发送到公开日志、模型或团队聊天。

启动前 AbortSignal 已取消时抛 `ABORTED`；运行中取消则返回 `status:'cancelled', reason:'aborted'`。
浏览器启动失败只警告，用户仍可复制 URL。默认浏览器启动使用系统命令。
关闭标签页不会自动保存；使用取消按钮、调用 `close()` 或等待会话时限。

## 6. 返回结果

```json
{
  "protocolVersion": "1.0",
  "pluginId": "demo/hello-world",
  "status": "completed",
  "persistence": "saved",
  "verification": "succeeded",
  "changedTargets": ["config"],
  "path": "/actual/home/.config/config-guide-demo/hello.json"
}
```

取消/超时为 `status:cancelled`、`persistence:unchanged`，用 reason 区分。
发生文件写入后的清理问题时返回 warnings，不能把已保存文件误报成“完全没有修改”。
启动和描述错误抛 `ConfigGuideError`；保存/校验错误显示在页面，允许修正后重试或取消。

未提供 `verify` 时 verification 为 `not-requested`；提供后必须验证成功才能保存，结果为 `succeeded`。

## 7. 协议与实现范围

兼容原 Go 原型的 Hello World JSON。现有 `form / targets / bindings / submit` 无需改写。
支持单层普通字段、文本/多行/URL/邮箱/数字/checkbox/select、秘密 keep/replace/delete、
一个 JSON 文件目标、嵌套对象 JSON Pointer、已有配置回填和只更新绑定字段。

本版不实现：OAuth/授权跳转、hooks/任意命令、系统钥匙串、多保存目标、YAML/TOML/dotenv、
复杂条件 UI、完整 JSON Schema 标准。声明未支持字段会报错，不会默默忽略。
详见 `docs/PROTOCOL.md`。

## 8. 权限和平台边界

POSIX：新配置文件使用 0600；新建目录使用 0700，不递归改变已有用户目录权限。
Windows：Node chmod 并不提供等价 ACL。本版在写入临时文件内容前，调用系统自带 Windows
PowerShell 的固定命令，设置并读取验证 protected DACL，只授予当前用户和 SYSTEM。
仅支持本地 NTFS/ReFS；不可用就失败，不降级为公开文件。不调用下载的 .ps1，
不使用 ExecutionPolicy Bypass，也不修改系统策略；组织的应用执行限制仍可能阻止这些命令。

当前没有 Windows/macOS 实机测试结果。仓库附跨平台 CI，工作流尚未在远端运行。
私有文件权限不是加密，也不隔离同用户程序、管理员或系统进程。
密码框只遮挡显示；写入 JSON 需要显式 `allowPlaintextSecrets:true`。

安全机制和残留锁处理见 `docs/SECURITY.md`。

## 9. 测试、打包与发布

```sh
npm test
npm pack --dry-run
npm pack
```

发布前核对 package.json 的 repository。当前预设为
`https://github.com/ZevaierZhan/config-guides.git`。
包使用 MIT License；发布前确认这符合你的授权选择。

npm / GitHub Packages 的完整命令和认证差异在 `docs/PUBLISHING.md`。

## 10. 目录

```text
src/                  Node.js SDK、协议、HTTP、文件保存、平台能力
web/                  随包提供的 HTML/CSS/JavaScript
bin/config-guide.js   可选 CLI
types/index.d.ts      TypeScript 声明
examples/             Hello World 和 OpenCLI Jira 示例
tests/                Node 原生测试
docs/                 协议、发布、安全和验证说明
.github/workflows/    跨平台 CI；手动 GitHub Packages 发布
```

## 核对参考（2026-09-20）

- OpenCLI 插件 API 与依赖安装：https://github.com/jackwener/OpenCLI/blob/main/docs/guide/plugins.md
- OpenCLI 注册定义：https://github.com/jackwener/OpenCLI/blob/main/src/registry.ts
- npm scoped 发布：https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- GitHub npm registry：https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry
- Node 文件权限：https://nodejs.org/api/fs.html#fspromiseschmodpath-mode
