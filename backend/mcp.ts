import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { SettingStore } from './store';

export const APP_URI = 'ui://alibi/app.html';
export const settingSchema = z.union([z.literal(1), z.literal(2)]);

export function createMcpServer(store: SettingStore, readHtml: () => Promise<string>, management = false) {
  const server = new McpServer({
    name: management ? 'alibi-management' : 'alibi',
    version: '1.0.0',
  });

  const settingResult = () => ({
    content: [{ type: 'text' as const, text: String(store.get()) }],
    structuredContent: { number: store.get() },
  });

  if (management) {
    server.registerTool('get_setting_number', {
      description: 'Get setting.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => settingResult());

    server.registerTool('set_setting_number', {
      description: 'Set setting.',
      inputSchema: { number: settingSchema },
    }, async ({ number }) => {
      store.set(number);

      return settingResult();
    });

    return server;
  }

  server.registerTool('hello_world', {
    description: 'Say hello.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: APP_URI } },
  }, async () => {
    const message = `Hello, World ${store.get()}`;

    return {
      content: [{ type: 'text' as const, text: message }],
      structuredContent: { message },
    };
  });

  registerAppResource(server, 'Alibi', APP_URI, {
    description: 'Greeting.',
  }, async () => ({
    contents: [{ uri: APP_URI, mimeType: RESOURCE_MIME_TYPE, text: await readHtml() }],
  }));

  return server;
}
