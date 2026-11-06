import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SettingStore } from './store';
import { project } from './validation-projects';
export const settingSchema = z.union([z.literal(1), z.literal(2)]);

export function createMcpServer(store: SettingStore, management = false, cwd?: string) {
  if (!management && !cwd) throw new Error('Developer MCP requires a project directory.');
  const server = new McpServer({
    name: management ? 'alibi-management' : 'alibi',
    version: '1.0.0',
  });

  const settingResult = () => ({
    content: [{ type: 'text' as const, text: String(store.get()) }],
    structuredContent: { number: store.get() },
  });

  if (management) {
    server.registerTool('get_setting_number', {
      description: 'Get setting.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => settingResult());

    server.registerTool('set_setting_number', {
      description: 'Set setting.',
      inputSchema: { number: settingSchema },
    }, async ({ number }) => {
      store.set(number);

      return settingResult();
    });

    return server;
  }

  server.registerTool('validate', {
    description: 'Run agent-policy validation for a project. Returns only failures; success produces no output.',
    inputSchema: {},
  }, async () => {
    try {
      const report = await (await project(cwd!)).runForAgent();
      const content = report.failures.map(failure => ({
        type: 'text' as const,
        text: `Failed: ${failure.name}\n${failure.output}`,
      }));
      if (report.cancelled) content.push({ type: 'text', text: 'Validation cancelled.' });
      return { content, ...(report.exitCode !== 0 ? { isError: true } : {}) };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
    }
  });

  return server;
}
