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
      nibble: { ...defaultNibble, dirtyFilesFirst: false, budget: 1, reserve: 1, rules: ['no-console', 'no-debugger'] },
    });
    const errors = await runner.nibble();
    expect(errors.map(error => error.rule)).toEqual(['no-console']);
    expect(errors[0]!.line).toBe(2);
    expect(runner.snapshot().nibbleCounts).toEqual({ 'no-console': 1, 'no-debugger': 2 });
    expect(errors[0]!.checkCommand).toBeDefined();
    expect(errors[0]!.checkCommand).not.toContain('--fix');
    const original = await Bun.file(join(cwd, 'sample.js')).text();
    const check = Bun.spawn(['bash', '-c', errors[0]!.checkCommand!], { cwd, stdout: 'ignore', stderr: 'ignore' });
    expect(await check.exited).toBe(1);
    expect(await Bun.file(join(cwd, 'sample.js')).text()).toBe(original);
    expect(runner.plan.nibble!.reserve).toBe(0);
    expect(runner.plan.nibble!.budget).toBe(1);
    expect((await Bun.file(join(cwd, '.alibi.json')).json()).nibble.budget).toBeUndefined();
    expect(await runner.nibble()).toEqual([]);
    expect(runner.snapshot().nibbleCounts).toEqual({ 'no-console': 1, 'no-debugger': 2 });
    await runner.configure({ ...runner.plan, nibble: { ...runner.plan.nibble!, budget: null } });
    expect(await runner.nibble()).toEqual([]);
    await runner.configure({
      ...runner.plan,
      eslint: { ...runner.plan.eslint, visible: { rules: { 'no-debugger': 'error', 'no-console': 'error' } } },
      nibble: { ...runner.plan.nibble!, budget: 1, reserve: 1, rules: ['no-debugger'] },
    });
    expect(await runner.nibble()).toHaveLength(2);
    await Bun.write(join(cwd, 'sample.js'), 'debugger;;\nconsole.log(1);\n');
    await runner.configure({
      ...runner.plan,
      eslint: { ...runner.plan.eslint, visible: { rules: { 'no-extra-semi': 'error', 'no-debugger': 'error', 'no-console': 'error' } } },
      nibble: { ...runner.plan.nibble!, budget: 1, reserve: 1, rules: ['no-extra-semi'] },
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
    expect(runner.plan.nibble!.reserve).toBe(0);
    expect(runner.plan.nibble!.budget).toBe(1);
    expect((await Bun.file(join(cwd, '.alibi.json')).json()).nibble.budget).toBeUndefined();
    runner.busy = true;
    await expect(runner.nibble()).rejects.toThrow('busy');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('nibble reports TypeScript errors', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-nibble-ts-'));
  try {
    await Bun.write(join(cwd, 'sample.ts'), 'const value: number = 1;\nif (value) console.log(value);\n');
    const runner = await Validation.create(cwd, { steps: [eslint], persist: false });
    await runner.configure({
      ...runner.plan,
      eslint: { default: { rules: { curly: 'error' } } },
      nibble: { ...defaultNibble, dirtyFilesFirst: false, budget: 1, reserve: 1, rules: ['curly'] },
    });
    const findings = await runner.nibble();
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe('curly');
    expect(findings[0]!.file).toBe('sample.ts');
    expect(runner.snapshot().nibbleCounts?.curly).toBe(1);
    expect(runner.plan.nibble!.reserve).toBe(0);
    expect(runner.plan.nibble!.budget).toBe(1);
    await runner.refreshNibbleCounts();
    expect(runner.snapshot().nibbleCounts?.curly).toBe(1);
    expect(runner.plan.nibble!.reserve).toBe(0);
    expect(runner.plan.nibble!.budget).toBe(1);
    expect(runner.busy).toBe(false);
    expect(runner.snapshot().running).toBe(false);
    const refresh = runner.refreshNibbleCounts();
    expect(runner.snapshot().running).toBe(true);
    await runner.stop();
    await refresh;
    expect(runner.busy).toBe(false);
    expect(runner.snapshot().running).toBe(false);
    expect(runner.snapshot().nibbleCounts?.curly).toBe(1);
    await Bun.write(join(cwd, 'sample.ts'), 'const value: number = 1;\nif (value) { console.log(value); }\n');
    await runner.runForAgent();
    while (runner.busy) await Bun.sleep(1);
    expect(runner.snapshot().nibbleCounts?.curly).toBe(0);
    await Bun.write(join(cwd, 'sample.ts'), 'if (true) console.log(1);\n');
    await runner.configure({ ...runner.plan, nibble: { ...runner.plan.nibble!, budget: 1, reserve: 1 } });
    await runner.nibble();
    expect(runner.snapshot().nibbleCounts?.curly).toBe(1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('nibble settings persist, reload, and reject invalid budgets and duplicate rules', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-nibble-'));
  const steps = [{ name: 'example', detect: () => true, run: async () => 0 }];
  try {
    const runner = await Validation.create(cwd, { steps });
    const nibble = { ...defaultNibble, budget: 12, reserve: 100, rules: ['eqeqeq', 'no-debugger'], randomSelection: true };
    await runner.configure({ ...runner.plan, nibble });
    const { budget: _, reserve: __, ...saved } = nibble;
    expect((await Bun.file(join(cwd, '.alibi.json')).json()).nibble).toEqual(saved);
    await runner.refreshConfig();
    expect(runner.plan.nibble).toEqual(nibble);
    const reloaded = await Validation.create(cwd, { steps });
    expect(reloaded.plan.nibble).toEqual({ ...nibble, budget: null, reserve: null });
    for (const budget of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(runner.configure({ ...runner.plan, nibble: { ...nibble, budget } })).rejects.toThrow();
    }
    await expect(runner.configure({ ...runner.plan, nibble: { ...nibble, rules: ['eqeqeq', 'eqeqeq'] } })).rejects.toThrow();
    expect(runner.plan.nibble).toEqual(nibble);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
