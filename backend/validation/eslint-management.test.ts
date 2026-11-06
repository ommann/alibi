import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp';
import { project } from '../validation-projects';

test('management runs selected ESLint analyses independent of policies without saving changes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-eslint-management-'));
  const server = createMcpServer(true);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    const config = JSON.stringify({
      eslint: { stage1: { rules: {} }, stage2: { rules: { 'no-debugger': 'error' } }, stage3: { rules: {} } },
      groups: [['eslint:stage1'], ['eslint:stage2'], ['eslint:stage3']],
      policies: { 'eslint:stage1': 'agent', 'eslint:stage2': 'off', 'eslint:stage3': 'user' },
    });
    await Bun.write(join(cwd, '.alibi.json'), config);
    await Bun.write(join(cwd, 'index.js'), 'debugger;');
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const runner = await project(cwd);
    const plan = structuredClone(runner.plan);
    const result = await client.callTool({ name: 'eslint_run', arguments: { cwd, analyses: ['eslint:stage2', 'eslint:stage3'] } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('no-debugger');
    expect(JSON.stringify(result.content)).toContain('eslint:stage3: passed');
    expect(runner.runs.at(-1)!.results.map(result => result.name)).toEqual(['eslint:stage2', 'eslint:stage3']);
    expect(runner.plan).toEqual(plan);
    expect(await Bun.file(join(cwd, '.alibi.json')).text()).toBe(config);
    const invalid = await client.callTool({ name: 'eslint_run', arguments: { cwd, analyses: ['npm:build'] } });
    expect(invalid.isError).toBe(true);
    expect(runner.runs).toHaveLength(1);
    const unknown = await client.callTool({ name: 'eslint_run', arguments: { cwd, analyses: ['eslint:missing'] } });
    expect(unknown.isError).toBe(true);
    runner.busy = true;
    const busy = await client.callTool({ name: 'eslint_run', arguments: { cwd, analyses: ['eslint:stage3'] } });
    expect(busy.isError).toBe(true);
    expect(JSON.stringify(busy.content)).toContain('Validation is busy');
    runner.busy = false;
  } finally {
    await client.close();
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
