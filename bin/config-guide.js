#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { runGuide, version } from '../src/index.js';

async function main() {
  const { values, positionals } = parseArgs({ options: {
    spec: { type: 'string' }, context: { type: 'string' }, 'plugin-dir': { type: 'string' },
    'workspace-dir': { type: 'string' }, 'no-open': { type: 'boolean' }, agent: { type: 'boolean' },
    timeout: { type: 'string', default: '15m' }, version: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  }, allowPositionals: true });
  if (values.version) { console.log(version); return; }
  if (values.help) {
    console.log(`@zevaier/config-guides ${version}
用法: config-guide --spec hello-world.json [--no-open] [--timeout 15m]
      config-guide --agent --spec generated-guide.json --timeout 30m
      config-guide --spec jira-guide.json --workspace-dir C:\\project
选项: --context 文件  --plugin-dir 目录  --workspace-dir 目录
--agent 自动打开浏览器但不输出含会话凭证的 URL，供本机智能体代用户启动。
需要 Node.js >=22；不需要 Go、原生程序或浏览器扩展。
stdout: 最终结果 JSON；stderr: 本地地址/提示。
退出码: 0 保存完成，2 取消/超时，1 启动失败。`); return;
  }
  if (positionals.length > 1 || (values.spec && positionals.length)) throw new Error('只提供一个 --spec 或位置参数');
  const specFile = values.spec || positionals[0];
  if (!specFile) throw new Error('需要 --spec 描述文件；使用 --help 查看用法');
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/u.exec(values.timeout);
  if (!match) throw new Error('timeout 示例: 500ms / 30s / 15m / 1h');
  const timeoutMs = Number(match[1]) * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000 })[match[2]];
  const context = values.context ? JSON.parse((await readFile(values.context, 'utf8')).replace(/^\uFEFF/, '')) : {};
  if (values['plugin-dir']) context.pluginDir = values['plugin-dir'];
  if (values['workspace-dir']) context.workspaceDir = values['workspace-dir'];
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const result = await runGuide({
      specFile, context, timeoutMs, openBrowser: !values['no-open'], signal: controller.signal,
      ...(values.agent ? {
        onReady: () => {},
        onWarning: () => process.stderr.write('配置引导工具：未能自动打开浏览器；请让 owner 在交互终端中不带 --agent 重新运行。\n'),
      } : {}),
    });
    console.log(JSON.stringify(result));
    process.exitCode = result.status === 'completed' ? 0 : 2;
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
main().catch(error => {
  // Parser/FS errors never include the contents of a config or submitted token.
  console.error(`配置引导工具: ${error.message}`);
  process.exitCode = 1;
});
