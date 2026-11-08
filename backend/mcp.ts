import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { project } from './validation-projects';
function assistantRunResult(run: import('../shared/contracts').Run) {
  return {
    content: run.results.map(result => ({
      type: 'text' as const,
      text: `${result.name}: ${result.status}\n${result.output}${result.reason ? `${result.reason}\n` : ''}`,
    })),
    ...(run.cancelled || run.results.some(result => result.status === 'failed') ? { isError: true } : {}),
  };
}

export function createMcpServer(management = false, cwd?: string) {
  if (!management && !cwd) throw new Error('Developer MCP requires a project directory.');
  const server = new McpServer({
    name: management ? 'alibi-management' : 'alibi',
    version: '1.0.0',
  });

  if (management) {
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

    server.registerTool('validation_run', {
      description: 'Run full project validation, one analysis, or an existing analysis group as the assistant, regardless of policies. Omit analysis and group for full validation. Records results without changing configuration. Fails while validation is busy.',
      inputSchema: {
        cwd: z.string().trim().min(1).describe('Project directory.'),
        analysis: z.string().trim().min(1).optional().describe('One configured analysis name.'),
        group: z.number().int().min(1).optional().describe('Existing analysis group number, starting at 1. Cannot be combined with analysis.'),
      },
    }, async ({ cwd, analysis, group }) => {
      try {
        return assistantRunResult(await (await project(cwd)).runValidation({ analysis, group }));
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
    });

    server.registerTool('eslint_run', {
      description: 'Run one ESLint rule or an existing named ESLint rule group as the assistant. A single rule runs at error severity without saving configuration. Records diagnostics in the UI. Fails while validation is busy.',
      inputSchema: {
        cwd: z.string().trim().min(1).describe('Project directory.'),
        rule: z.string().trim().min(1).optional().describe('One ESLint rule, for example no-debugger or solid/reactivity.'),
        group: z.string().trim().min(1).optional().describe('Existing ESLint group name, for example stage2 or eslint:stage2. Select either rule or group.'),
      },
    }, async ({ cwd, rule, group }) => {
      try {
        if ((rule === undefined) === (group === undefined)) throw new Error('Select one ESLint rule or group.');
        const runner = await project(cwd);
        const run = rule !== undefined ? await runner.runESLintRule(rule)
          : await runner.runESLint([group!.startsWith('eslint:') || group === 'eslint' ? group! : `eslint:${group}`]);
        return assistantRunResult(run);
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
