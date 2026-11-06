import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPlan, Validation } from './core.ts';
import { workspaceTests } from './workspace-tests.ts';

test('workspace tests become sequential units and stop at the first agent failure', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-workspaces-'));
  try {
    await Bun.write(join(cwd, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'], scripts: { test: 'npm run test --workspaces --if-present' } }));
    for (const [name, script] of [['a', 'node -e "console.log(123)"'], ['b', 'node -e "console.error(456);process.exit(1)"'], ['c', 'node -e "console.log(789)"'], ['skip', undefined]]) {
      await Bun.write(join(cwd, `packages/${name}/package.json`), JSON.stringify({ name: `@demo/${name}`, scripts: script ? { test: script } : {} }));
    }
    const names = ['npm:test:@demo/a', 'npm:test:@demo/b', 'npm:test:@demo/c'];
    const units = await workspaceTests(cwd);
    expect(units.map(step => step.name)).toEqual(names);
    const userPlan = checkPlan({ groups: [['npm:test']], policies: { 'npm:test': 'user' } }, units);
    expect(userPlan.groups).toEqual(names.map(name => [name]));
    expect(Object.values(userPlan.policies)).toEqual(['user', 'user', 'user']);
    const removedPlan = checkPlan({ groups: [], policies: { 'npm:test': 'off' }, removed: ['npm:test'] }, units);
    expect(removedPlan.groups).toEqual([]);
    expect(removedPlan.removed).toEqual(names);
    expect(() => checkPlan({ groups: [[]], policies: {} }, units)).toThrow('Groups must be non-empty arrays');
    await Bun.write(join(cwd, '.alibi.json'), JSON.stringify({ groups: [['npm:test']], policies: { 'npm:test': 'agent' } }));
    const runner = await Validation.create(cwd);
    expect(runner.plan.groups.slice(0, 3)).toEqual(names.map(name => [name]));
    expect(runner.steps.some(step => step.name === 'npm:test')).toBe(false);
    // Disable unrelated built-in analyses for this fixture.
    await runner.configure({ ...runner.plan, policies: Object.fromEntries(runner.steps.map(step => [step.name, names.includes(step.name) ? 'agent' : 'off'])) });
    const report = await runner.runForAgent();
    while (runner.busy) await Bun.sleep(5);
    expect(report.failures.map(result => result.name)).toEqual([names[1]!]);
    expect(report.failures[0]!.output).toContain('456');
    const results = runner.runs.at(-1)!.results;
    expect(results.find(result => result.name === names[0])!.status).toBe('passed');
    expect(results.find(result => result.name === names[2])!.status).toBe('skipped');
    expect(JSON.stringify(report)).not.toContain('789');
    expect((await Validation.create(cwd)).plan.groups.slice(0, 3)).toEqual(names.map(name => [name]));
    await Bun.write(join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }));
    expect(await workspaceTests(cwd)).toEqual([]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
