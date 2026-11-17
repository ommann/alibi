import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp';
import { project } from '../validation-projects';

test('management creates and deletes persisted ESLint groups safely', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-eslint-groups-'));
  const server = createMcpServer(true);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Bun.write(join(cwd, '.alibi.json'), JSON.stringify({ groups: [], policies: {} }));
    await server.connect(st);
    await client.connect(ct);
    const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { cwd, name: 'perfectionist', ...args } });
    const created = await call('eslint_group_create', { rules: { 'perfectionist/sort-imports': 'error' } });
    expect(created.isError).not.toBe(true);
    const runner = await project(cwd);
    expect(runner.plan.eslint?.perfectionist).toEqual({ rules: { 'perfectionist/sort-imports': 'error' } });
    expect(runner.plan.policies['eslint:perfectionist']).toBe('user');
    expect(runner.plan.groups).toContainEqual(['eslint:perfectionist']);
    const read = await call('eslint_group_get');
    expect(read.isError).not.toBe(true);
    expect(JSON.stringify(read.content)).toContain('perfectionist/sort-imports');
    const update = (args: Record<string, unknown> = {}) => client.callTool({ name: 'eslint_rule_update', arguments: { cwd, group: 'perfectionist', rule: 'perfectionist/sort-imports', value: ['warn', { type: 'natural' }], ...args } });
    expect((await update()).isError).not.toBe(true);
    expect(runner.plan.eslint?.perfectionist).toEqual({ rules: { 'perfectionist/sort-imports': ['warn', { type: 'natural' }] } });
    expect((await update({ rule: 'missing' })).isError).toBe(true);
    expect((await update({ override: 1 })).isError).toBe(true);
    await runner.configure({ ...runner.plan, eslint: { ...runner.plan.eslint, perfectionist: [
      { rules: { 'perfectionist/sort-imports': 'error' } },
      { files: ['**/*.ts'], rules: { 'perfectionist/sort-imports': 'warn' } },
    ] } });
    expect((await update()).isError).toBe(true);
    expect((await update({ override: 1, value: 'off' })).isError).not.toBe(true);
    expect(runner.plan.eslint?.perfectionist).toEqual([
      { rules: { 'perfectionist/sort-imports': 'error' } },
      { files: ['**/*.ts'], rules: { 'perfectionist/sort-imports': 'off' } },
    ]);
    const saved = await Bun.file(join(cwd, '.alibi.json')).text();
    expect((await call('eslint_group_create')).isError).toBe(true);
    expect(await Bun.file(join(cwd, '.alibi.json')).text()).toBe(saved);
    runner.busy = true;
    expect((await update({ override: 0 })).isError).toBe(true);
    expect((await call('eslint_group_delete')).isError).toBe(true);
    runner.busy = false;
    expect(await Bun.file(join(cwd, '.alibi.json')).text()).toBe(saved);
    expect((await call('eslint_group_delete')).isError).not.toBe(true);
    expect(runner.plan.eslint?.perfectionist).toBeUndefined();
    expect(runner.plan.groups.flat()).not.toContain('eslint:perfectionist');
    expect(runner.plan.policies['eslint:perfectionist']).toBeUndefined();
    expect(await Bun.file(join(cwd, '.alibi.json')).json()).toEqual(runner.plan);
    expect((await call('eslint_group_delete')).isError).toBe(true);
    expect((await call('eslint_group_create', { name: 'eslint:bad' })).isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
