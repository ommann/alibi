import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Validation } from './core';
import { defaultNibble } from '../../shared/nibble';
import eslint from './steps/eslint';

test('nibble ignores validation policies, follows rule priority, and consumes its allowance', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-nibble-errors-'));
  try {
    await Bun.write(join(cwd, 'sample.js'), 'debugger;\nconsole.log(1);\ndebugger;\n');
    const runner = await Validation.create(cwd, { steps: [eslint] });
    await runner.configure({
      ...runner.plan,
      eslint: { visible: { rules: { 'no-debugger': 'error' } }, hidden: { rules: { 'no-console': 'error' } } },
      groups: [['eslint:visible'], ['eslint:hidden']],
      policies: { 'eslint:visible': 'agent', 'eslint:hidden': 'user' },
      nibble: { ...defaultNibble, dirtyFilesFirst: false, budget: 1, rules: ['no-console', 'no-debugger'] },
    });
    const errors = await runner.nibble();
    expect(errors.map(error => error.rule)).toEqual(['no-console']);
    expect(errors[0]!.line).toBe(2);
    expect(errors[0]!.checkCommand).toBeDefined();
    expect(errors[0]!.checkCommand).not.toContain('--fix');
    const original = await Bun.file(join(cwd, 'sample.js')).text();
    const check = Bun.spawn(['bash', '-c', errors[0]!.checkCommand!], { cwd, stdout: 'ignore', stderr: 'ignore' });
    expect(await check.exited).toBe(1);
    expect(await Bun.file(join(cwd, 'sample.js')).text()).toBe(original);
    expect(runner.plan.nibble!.budget).toBe(0);
    expect((await Bun.file(join(cwd, '.alibi.json')).json()).nibble.budget).toBe(0);
    expect(await runner.nibble()).toEqual([]);
    await runner.configure({ ...runner.plan, nibble: { ...runner.plan.nibble!, budget: null } });
    expect(await runner.nibble()).toEqual([]);
    await runner.configure({
      ...runner.plan,
      eslint: { ...runner.plan.eslint, visible: { rules: { 'no-debugger': 'error', 'no-console': 'error' } } },
      nibble: { ...runner.plan.nibble!, budget: 1, rules: ['no-debugger'] },
    });
    expect(await runner.nibble()).toHaveLength(2);
    await Bun.write(join(cwd, 'sample.js'), 'debugger;;\nconsole.log(1);\n');
    await runner.configure({
      ...runner.plan,
      eslint: { ...runner.plan.eslint, visible: { rules: { 'no-extra-semi': 'error', 'no-debugger': 'error', 'no-console': 'error' } } },
      nibble: { ...runner.plan.nibble!, budget: 1, rules: ['no-extra-semi'] },
    });
    const findings = await runner.nibble();
    expect(findings).toHaveLength(1);
    expect(findings.every(error => error.rule === 'no-extra-semi')).toBe(true);
    const command = findings.find(error => error.fixCommand)?.fixCommand;
    expect(command).toContain('--fix');
    const fix = Bun.spawn(['bash', '-c', command!], { cwd, stdout: 'ignore', stderr: 'pipe' });
    await new Response(fix.stderr).text();
    expect(await fix.exited).toBe(0); // Only the selected rule is checked.
    expect(await Bun.file(join(cwd, 'sample.js')).text()).not.toContain(';;');
    const verify = Bun.spawn(['bash', '-c', findings[0]!.checkCommand!], { cwd, stdout: 'ignore', stderr: 'ignore' });
    expect(await verify.exited).toBe(0);
    expect(runner.plan.nibble!.budget).toBe(0);
    expect((await Bun.file(join(cwd, '.alibi.json')).json()).nibble.budget).toBe(0);
    runner.busy = true;
    await expect(runner.nibble()).rejects.toThrow('busy');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('nibble settings persist, reload, and reject invalid budgets and duplicate rules', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-nibble-'));
  const steps = [{ name: 'example', detect: () => true, run: async () => 0 }];
  try {
    const runner = await Validation.create(cwd, { steps });
    const nibble = { ...defaultNibble, budget: 12, rules: ['eqeqeq', 'no-debugger'], randomSelection: true };
    await runner.configure({ ...runner.plan, nibble });
    expect((await Bun.file(join(cwd, '.alibi.json')).json()).nibble).toEqual(nibble);
    const reloaded = await Validation.create(cwd, { steps });
    expect(reloaded.plan.nibble).toEqual(nibble);
    for (const budget of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(runner.configure({ ...runner.plan, nibble: { ...nibble, budget } })).rejects.toThrow();
    }
    await expect(runner.configure({ ...runner.plan, nibble: { ...nibble, rules: ['eqeqeq', 'eqeqeq'] } })).rejects.toThrow();
    expect(runner.plan.nibble).toEqual(nibble);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
