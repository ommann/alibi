import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMcpServer, settingSchema } from './mcp';
import { SettingStore } from './store';
import { config } from './config';
import { validationHttp } from './validation-http';
import { rpcHandler } from './rpc';

const port = config.PORT;

const origin = `http://localhost:${port}`;

const store = new SettingStore();
const appHtml = () => Bun.file('dist/app/index.html').text();

type Session = {
  transport: StreamableHTTPTransport;
  server: ReturnType<typeof createMcpServer>;
  management: boolean;
};

const sessions = new Map<string, Session>();

const app = new Hono();
app.route('/api/validation', validationHttp);

app.onError((error, c) => {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return c.json({ error: 'Invalid request' }, 400);

  console.error(error);

  return c.json({ error: 'Internal server error' }, 500);
});

app.on(['GET', 'POST', 'DELETE'], ['/mcp', '/manage/mcp'], async (c) => {
  const management = c.req.path === '/manage/mcp';
  const sessionId = c.req.header('mcp-session-id');

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.management !== management)
      return c.json({ error: 'MCP session not found; reconnect.' }, 404);
    return (await session.transport.handleRequest(c)) ?? c.body(null, 202);
  }
  if (c.req.method !== 'POST') return c.json({ error: 'Initialize an MCP session first.' }, 400);
  const body: unknown = await c.req.json();
  if (!isInitializeRequest(body)) return c.json({ error: 'Expected MCP initialize request.' }, 400);

  const server = createMcpServer(store, appHtml, management);
  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, server, management });
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);

  return (await transport.handleRequest(c, body)) ?? c.body(null, 202);
});

app.get('/api/health', (c) => c.json({ service: 'hello-world' }));
app.get('/api/setting', (c) => c.json({ number: store.get() }));

app.post('/api/setting', async (c) => {
  const { number } = z.object({ number: settingSchema }).parse(await c.req.json());
  return c.json({ number: store.set(number) });
});

app.all('/rpc/*', async (c) => {
  const url = new URL(c.req.url);
  const requestOrigin = c.req.header('Origin');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      (requestOrigin && requestOrigin !== url.origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
    return c.json({ error: 'Cross-origin request rejected' }, 403);
  }
  const { response } = await rpcHandler.handle(c.req.raw, { prefix: '/rpc' });
  return response ?? c.notFound();
});

app.get('/ui/*', async (c) => {
  const name = c.req.path.slice('/ui/'.length);
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return c.notFound();
  const file = Bun.file(`dist/ui/browser/${name}`);
  return await file.exists() ? new Response(file) : c.notFound();
});
for (const path of ['/', '/presentation']) {
  app.get(path, async (c) => c.html(await Bun.file('dist/ui/browser/index.html').text()));
}

const http = Bun.serve({ hostname: '127.0.0.1', port, idleTimeout: 0, fetch: app.fetch });

console.log(`Web UI: ${origin}\nMCP: ${origin}/mcp\nManagement MCP: ${origin}/manage/mcp`);

async function shutdown() {
  for (const { server } of sessions.values()) await server.close();

  await http.stop(true);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
