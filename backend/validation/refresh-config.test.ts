import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Validation } from './core';

test('refresh reloads without writing, preserves runs, and rejects invalid or busy changes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-refresh-'));
  const path = join(cwd, '.alibi.json');
  try {
    const runner = await Validation.create(cwd, { steps: [
      { name: 'example', detect: () => true, run: async () => 0 },
    ] });
    await runner.detect();
    const runs = runner.runs;
    const contents = JSON.stringify({ groups: [['example']], policies: { example: 'off' } });
    await Bun.write(path, contents);
    await runner.refreshConfig();
    expect(runner.plan.policies.example).toBe('off');
    expect(runner.detections).toEqual({});
    expect(runner.runs).toBe(runs);
    expect(await Bun.file(path).text()).toBe(contents);
    const plan = runner.plan;

    for (const invalid of ['{', JSON.stringify({ groups: [['unknown']], policies: {} })]) {
      await Bun.write(path, invalid);
      await expect(runner.refreshConfig()).rejects.toThrow();
      expect(runner.plan).toBe(plan);
      expect(runner.busy).toBe(false);
      expect(await Bun.file(path).text()).toBe(invalid);
    }
    runner.busy = true;
    await expect(runner.refreshConfig()).rejects.toThrow('Validation is busy');
    expect(runner.plan).toBe(plan);
    runner.busy = false;
    await rm(path);
    await expect(runner.refreshConfig()).rejects.toThrow();
    expect(runner.plan).toBe(plan);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
