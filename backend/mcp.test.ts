import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp';
import { project } from './validation-projects';

test('developer MCP exposes only validation and returns only errors', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-mcp-'));
  const server = createMcpServer(false, cwd);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    expect(tools.map(tool => tool.name)).toEqual(['validate']);
    expect(tools[0]!.inputSchema.properties).toEqual({});
    const config = await Bun.file('.alibi.json').json();
    config.policies = Object.fromEntries(Object.keys(config.policies).map(name => [name, name === 'npm:build' ? 'agent' : 'off']));
    await Bun.write(join(cwd, '.alibi.json'), JSON.stringify(config));
    await Bun.write(join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'echo HAPPY_OUTPUT' } }));
    const success = await client.callTool({ name: 'validate', arguments: {} });
    expect(success.content).toEqual([]);
    expect(success.isError).not.toBe(true);

    while ((await project(cwd)).busy) await Bun.sleep(10);
    await Bun.write(join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'echo FAILURE_OUTPUT >&2; exit 1' } }));
    const failure = await client.callTool({ name: 'validate', arguments: {} });
    expect(failure.isError).toBe(true);
    expect(JSON.stringify(failure.content)).toContain('FAILURE_OUTPUT');
    expect(JSON.stringify(failure)).not.toContain('HAPPY_OUTPUT');
  } finally {
    await client.close();
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('management MCP exposes only configuration refresh and execution tools', async () => {
  const server = createMcpServer(true);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['refresh_alibi_config', 'validation_run', 'eslint_run']);
  } finally {
    await client.close();
    await server.close();
  }
});
