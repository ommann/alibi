import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { project } from './validation-projects';
export const settingSchema = z.union([z.literal(1), z.literal(2)]);

export function createMcpServer(management = false, cwd?: string) {
  if (!management && !cwd) throw new Error('Developer MCP requires a project directory.');
  const server = new McpServer({
    name: management ? 'alibi-management' : 'alibi',
    version: '1.0.0',
  });

  if (management) {
    server.registerTool('get_alibi_config_path', {
      description: 'Get the absolute Alibi configuration file path for a project. The file may not exist yet.',
      inputSchema: { cwd: z.string().trim().min(1).describe('Project directory.') },
      annotations: { readOnlyHint: true },
    }, async ({ cwd }) => ({
      content: [{ type: 'text' as const, text: resolve(cwd, '.alibi.json') }],
    }));

    server.registerTool('refresh_alibi_config', {
      description: 'Reload a project’s .alibi.json into Alibi after editing it externally. Updates the UI without writing the file. Invalid configuration preserves the current plan. Fails while validation is busy.',
      inputSchema: { cwd: z.string().trim().min(1).describe('Project directory.') },
    }, async ({ cwd }) => {
      try {
        await (await project(cwd)).refreshConfig();
        return { content: [{ type: 'text' as const, text: 'Alibi configuration refreshed.' }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
    });

    server.registerTool('eslint_run', {
      description: 'Run selected configured ESLint analyses regardless of their normal policies. Returns CLI-style diagnostics and records results in the UI without changing the saved plan. Refresh configuration first after external edits. Fails while validation is busy.',
      inputSchema: {
        cwd: z.string().trim().min(1).describe('Project directory.'),
        analyses: z.array(z.string().min(1)).min(1).describe('Analysis names, for example eslint:stage2.'),
      },
    }, async ({ cwd, analyses }) => {
      try {
        const run = await (await project(cwd)).runESLint(analyses);
        return {
          content: run.results.map(result => ({
            type: 'text' as const,
            text: `${result.name}: ${result.status}\n${result.output}${result.reason ? `${result.reason}\n` : ''}`,
          })),
          ...(run.cancelled || run.results.some(result => result.status === 'failed') ? { isError: true } : {}),
        };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
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
