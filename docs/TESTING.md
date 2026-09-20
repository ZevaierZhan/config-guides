# 本次验证记录 · 2026-09-20

环境：Linux x86_64，Node.js 22.16.0，npm 10.9.2。

## 已执行

- Node 原生测试 35 项全部通过。
- TypeScript 声明/调用契约通过严格 NodeNext 类型检查。
- 原始 Hello World 描述无需改写即可被新协议读取。
- 真实 HTTP：loopback 监听、静态资源、会话 Token、Host/Origin、请求体限制。
- 配置：嵌套映射、Unicode、BOM、保留无关字段、数值范围、目标冲突、锁和文件权限。
- 秘密：初始值不回填、keep/replace/delete、必填和不回显。
- 生命周期：取消、超时、AbortSignal、重复 close、宿主 callback 抛错后的清理。
- 浏览器：Chromium 144.0.7559.96，Hello World/Jira 两个页面；桌面和手机布局、表单输入、秘密遮挡、保存和结果提示。

浏览器测试的准确边界：受管 Chromium 不能直接打开测试的 loopback 页面，
因此使用内存加载实际 web 资源，再桥接 fetch 到真实 Node HTTP 服务。
HTTP API 本身已另外通过原生 Node fetch 测试；这不等于验证了用户操作系统的浏览器自动启动或直接导航。
浏览器测试不使用 OCR。

打包后验证流程：npm pack → 新建干净消费项目 → 从 .tgz 离线 npm install →
按包名直接 ESM import → 读取随包 UI → 提交表单 → 保存文件 → 返回并退出。
消费测试脚本在 tests/packed-consumer.mjs；不要在源码根目录运行它来冒充安装验证。

## 尚未执行

- Windows/macOS 实机运行和 Windows ACL 测试；CI 文件只是已提供，并未远端运行。
- 完整 OpenCLI plugin install/发现/转译/执行链路；示例仅按当前官方接口编写。
- npm/GitHub Packages 登录及实际发布；只有本地 tarball，不代表 registry 上已存在这个版本。
- Jira 等真实服务器由宿主插件提供 `verify` Adapter；SDK 测试覆盖候选配置、超时、失败不落盘及成功后保存。
- 恶意同用户进程对抗、断电恢复和第三方安全审计。

当前环境无法解析外部 registry/GitHub 域名，因此没有安装完整 OpenCLI 来运行端到端测试。
实现依据的官方插件文档与 registry.ts 已通过网页工具核对。

## 复现

```sh
npm test
# 需要开发者自己的 TypeScript，类型测试本身不执行示例程序：
tsc --noEmit --strict --module NodeNext --target ES2022 tests/types.test.mts
# 可选浏览器测试需开发者安装 Python Playwright/Chromium；不是 npm 运行依赖：
CHROMIUM_BIN=/usr/bin/chromium python tests/browser.py
npm pack
```
