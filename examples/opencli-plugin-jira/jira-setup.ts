import { cli, Strategy } from '@jackwener/opencli/registry';
import { runGuide } from '@zevaier/config-guides';

cli({
  site: 'jira',
  name: 'setup',
  description: '在本机浏览器中配置 Jira',
  access: 'write',
  strategy: Strategy.PUBLIC,
  browser: false, // 向导自己启动本地网页，不使用 OpenCLI 的浏览器扩展。
  args: [],
  columns: ['status', 'path', 'verification'],
  func: async () => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    try {
      const result = await runGuide({
        specFile: new URL('./jira-guide.json', import.meta.url),
        signal: controller.signal,
        // 默认向 stderr 输出本地链接。SDK 不往 stdout 输出、不退出宿主进程。
        // onReady 可将链接送入你自己的本地 UI；不要把带令牌链接送到模型上下文。
      });
      return [{ status: result.status, path: result.path, verification: result.verification }];
    } finally {
      process.off('SIGINT', cancel);
    }
  },
});
