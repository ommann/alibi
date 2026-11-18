import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { project } from './validation-projects';
import { ruleSettings, setESLintRule } from '../shared/eslint-plan';
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
    const groupName = z.string().trim().min(1).regex(/^[^:]+$/, 'Use a group name without the eslint: prefix.');
    server.registerTool('eslint_group_get', {
      description: 'Read a named ESLint group, including its full configuration, policy, and analysis group position. Omit name to list all configured ESLint groups. Does not change configuration.',
      inputSchema: { cwd: z.string().trim().min(1), name: groupName.optional() },
    }, async ({ cwd, name }) => {
      try {
        const { plan } = await project(cwd);
        if (name !== undefined && !Object.hasOwn(plan.eslint ?? {}, name)) throw new Error(`Unknown ESLint group: ${name}`);
        const groups = Object.entries(plan.eslint ?? {}).filter(([key]) => name === undefined || key === name).map(([key, configuration]) => {
          const id = key === 'default' ? 'eslint' : `eslint:${key}`;
          const position = plan.groups.findIndex(group => group.includes(id));
          return { name: key, configuration, policy: plan.policies[id], group: position < 0 ? null : position + 1, removed: plan.removed?.includes(id) ?? false };
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(groups, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
    });

    server.registerTool('eslint_rule_update', {
      description: 'Overwrite an existing rule severity/options in one inline ESLint group. Leaves other rules and file scopes unchanged; does not merge options. For multiple scoped overrides, specify the zero-based override index among occurrences of this rule. Saves .alibi.json and updates the UI. File-backed groups are read-only. Fails while validation is busy.',
      inputSchema: {
        cwd: z.string().trim().min(1),
        group: groupName,
        rule: z.string().trim().min(1),
        value: z.union([
          z.enum(['off', 'warn', 'error']), z.number().int().min(0).max(2),
          z.tuple([z.union([z.enum(['off', 'warn', 'error']), z.number().int().min(0).max(2)])]).rest(z.json()),
        ]),
        override: z.number().int().min(0).optional(),
      },
    }, async ({ cwd, group, rule, value, override }) => {
      try {
        const runner = await project(cwd);
        const config = runner.plan.eslint?.[group];
        if (!config) throw new Error(`Unknown ESLint group: ${group}`);
        const settings = ruleSettings(config, rule);
        if (!settings.length) throw new Error(`Rule is not configured in ${group}: ${rule}`);
        if (settings.length > 1 && override === undefined) throw new Error('Rule has multiple overrides; specify an override index.');
        await runner.configure(setESLintRule(runner.plan, group, rule, override ?? 0, value));
        return { content: [{ type: 'text' as const, text: `Updated ${rule} in ESLint group: ${group}` }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
    });

    server.registerTool('eslint_group_create', {
      description: 'Create a named ESLint rule group, save .alibi.json, and update the UI. Appends a new analysis group with user-only policy by default. Fails for existing names or while validation is busy.',
      inputSchema: {
        cwd: z.string().trim().min(1),
        name: groupName,
        rules: z.record(z.string(), z.union([
          z.enum(['off', 'warn', 'error']), z.number().int().min(0).max(2),
          z.tuple([z.union([z.enum(['off', 'warn', 'error']), z.number().int().min(0).max(2)])]).rest(z.json()),
        ])).default({}),
        policy: z.enum(['user', 'agent', 'off']).default('user'),
      },
    }, async ({ cwd, name, rules, policy }) => {
      try {
        const runner = await project(cwd);
        const plan = structuredClone(runner.plan);
        if (Object.hasOwn(plan.eslint ?? {}, name)) throw new Error(`ESLint group already exists: ${name}`);
        const id = `eslint:${name}`;
        plan.eslint = { ...plan.eslint, [name]: { rules } };
        plan.groups.push([id]);
        plan.policies[id] = policy;
        plan.removed = plan.removed?.filter(item => item !== id);
        await runner.configure(plan);
        return { content: [{ type: 'text' as const, text: `Created ESLint group: ${name}` }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
    });

    server.registerTool('eslint_group_delete', {
      description: 'Delete a named ESLint group and its ordering, policy, and configuration references. Saves .alibi.json and updates the UI. Does not alter historical runs. Fails for missing groups or while validation is busy.',
      inputSchema: { cwd: z.string().trim().min(1), name: groupName },
    }, async ({ cwd, name }) => {
      try {
        const runner = await project(cwd);
        const plan = structuredClone(runner.plan);
        if (!Object.hasOwn(plan.eslint ?? {}, name)) throw new Error(`Unknown ESLint group: ${name}`);
        const id = `eslint:${name}`;
        delete plan.eslint![name];
        plan.groups = plan.groups.map(group => group.filter(item => item !== id)).filter(group => group.length);
        delete plan.policies[id];
        delete plan.configs?.[id];
        plan.removed = plan.removed?.filter(item => item !== id);
        await runner.configure(plan);
        return { content: [{ type: 'text' as const, text: `Deleted ESLint group: ${name}` }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
      }
    });

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

  server.registerTool('nibble', {
    description: 'Return ESLint errors selected by the user’s Nibble settings. Each returned error consumes one unit of the persistent budget. Unset or exhausted budgets return no output.',
    inputSchema: {},
  }, async () => {
    try {
      const errors = await (await project(cwd!)).nibble();
      const content = errors.map(error => ({ type: 'text' as const, text: `${error.file}:${error.line}:${error.column} ${error.rule}: ${error.message}` }));
      const checks = [...new Set(errors.flatMap(error => error.checkCommand ? [error.checkCommand] : []))];
      if (checks.length) content.push({ type: 'text', text: `Verification commands:\n${checks.join('\n')}` });
      const commands = [...new Set(errors.flatMap(error => error.fixCommand ? [error.fixCommand] : []))];
      if (commands.length) content.push({ type: 'text', text: `Automatic fixes:\n${commands.join('\n')}` });
      return { content };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: String(error) }], isError: true };
    }
  });

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
