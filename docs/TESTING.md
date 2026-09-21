# 本次验证记录 · 2026-09-21

本地环境：Windows x64，Node.js 24；远端 GitHub Actions 覆盖 Windows、macOS、Linux 的 Node.js 22/24。

## 已执行

- Node 原生测试 43 项全部通过。
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

- Windows/macOS 人工交互测试；GitHub Actions 的六组自动化测试已经运行通过。
- 完整 OpenCLI plugin install/发现/转译/执行链路；示例仅按当前官方接口编写。
- npm/GitHub Packages 登录及实际发布；正式产物发布为公开 GitHub Release tarball。
- Jira 等真实服务器由宿主插件提供 `verify` Adapter；SDK 测试覆盖候选配置、超时、失败不落盘及成功后保存。
- variant 测试覆盖动态必填、拒绝非活动提交、删除旧分支凭证及验证器收到清理后的候选配置；富文本测试覆盖危险标签、事件属性和 javascript URL 清洗。
- 恶意同用户进程对抗、断电恢复和第三方安全审计。

OpenCLI 插件的 GitHub Release 依赖更新后另行执行端到端安装验证。

## 复现

```sh
npm test
# 需要开发者自己的 TypeScript，类型测试本身不执行示例程序：
tsc --noEmit --strict --module NodeNext --target ES2022 tests/types.test.mts
# 可选浏览器测试需开发者安装 Python Playwright/Chromium；不是 npm 运行依赖：
CHROMIUM_BIN=/usr/bin/chromium python tests/browser.py
npm pack
```
