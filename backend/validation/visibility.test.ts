import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Validation } from './core.ts';

test('all enabled checks continue after the agent report returns on the first failure', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-visibility-'));
  try {
    const executed: string[] = [];
    const releaseUser = Promise.withResolvers<void>();
    const names = ['first', 'later-agent', 'user-failure', 'last-user', 'disabled'];
    const runner = await Validation.create(cwd, {
      persist: false,
      steps: names.map(name => ({
        name,
        detect: () => true,
        run: async () => {
          executed.push(name);
          if (name === 'user-failure') await releaseUser.promise;
          return name === 'first' || name === 'user-failure' ? 1 : 0;
        },
      })),
    });
    await runner.configure({
      ...runner.plan,
      groups: [['first'], ['later-agent', 'user-failure'], ['last-user'], ['disabled']],
      policies: { first: 'agent', 'later-agent': 'agent', 'user-failure': 'user', 'last-user': 'user', disabled: 'off' },
    });
    const report = await runner.runForAgent();
    // The MCP-facing result must not wait for user-only work to finish.
    try {
      expect(runner.busy).toBe(true);
      expect(report.failures.map(result => result.name)).toEqual(['first']);
    } finally {
      releaseUser.resolve();
    }
    while (runner.busy) await Bun.sleep(5);
    expect(report.failures.map(result => result.name)).toEqual(['first']);
    expect(executed).toEqual(['first', 'later-agent', 'user-failure', 'last-user']);
    expect(runner.runs.at(-1)!.results.map(result => result.policy)).toEqual([
      'agent', 'user', 'user', 'user', 'off',
    ]);
    expect(runner.plan.policies['later-agent']).toBe('agent');
    expect(runner.runs.at(-1)!.results.map(result => [result.name, result.status])).toEqual([
      ['first', 'failed'],
      ['later-agent', 'passed'],
      ['user-failure', 'failed'],
      ['last-user', 'passed'],
      ['disabled', 'skipped'],
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
