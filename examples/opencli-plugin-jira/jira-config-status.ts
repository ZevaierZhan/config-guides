import { cli, Strategy } from '@jackwener/opencli/registry';
import { getConfigPath, readConfig } from '@zevaier/config-guides';

interface JiraConfig extends Record<string, unknown> {
  connection?: { baseUrl?: string };
  auth?: { username?: string; mode?: string; token?: string };
}
cli({
  site: 'jira', name: 'config-status', description: '查看 Jira 本地配置（不显示凭据，不验证远端登录）',
  access: 'read', strategy: Strategy.PUBLIC, browser: false, args: [],
  columns: ['configured', 'baseUrl', 'username', 'tokenSaved', 'path'],
  func: async () => {
    const source = { specFile: new URL('./jira-guide.json', import.meta.url) };
    const config = await readConfig<JiraConfig>(source);
    // 业务请求可以在本机使用 config.auth.token，但不能输出整个 config！
    return [{
      configured: !!config,
      baseUrl: config?.connection?.baseUrl ?? '',
      username: config?.auth?.username ?? '',
      tokenSaved: !!config?.auth?.token,
      path: await getConfigPath(source),
    }];
  },
});
