import { Hono } from 'hono';
import { resolve } from 'node:path';
import { Validation } from './validation/core';

// One independent runner per project; simultaneous first requests share initialization.
const projects = new Map<string, Promise<Validation>>();
function project(cwd: string) {
  const path = resolve(cwd);
  let pending = projects.get(path);
  if (!pending) {
    pending = Validation.create(path);
    projects.set(path, pending);
    pending.catch(() => projects.delete(path));
  }
  return pending;
}

export const validationHttp = new Hono();

// These local endpoints can execute project code. Reject cross-origin browser calls.
validationHttp.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const origin = c.req.header('Origin');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      (origin && origin !== url.origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
    return c.json({ error: 'Cross-origin request rejected' }, 403);
  }
  if (c.req.method === 'POST' &&
      (c.req.header('X-Validate') !== '1' || !c.req.header('Content-Type')?.startsWith('application/json'))) {
    return c.json({ error: 'JSON and X-Validate header required' }, 403);
  }
  await next();
});

validationHttp.onError((error, c) => {
  const code = (error as { code?: string }).code;
  const status = code === 'ENOENT' || code === 'ENOTDIR' ? 404 :
    String(error).includes('Validation is busy') ? 409 : 400;
  return c.json({ error: String(error) }, status);
});

validationHttp.get('/state', async (c) => {
  const cwd = c.req.query('cwd');
  if (!cwd) return c.json({ error: 'cwd is required' }, 400);
  return c.json((await project(cwd)).snapshot());
});

validationHttp.post('/:action', async (c) => {
  const action = c.req.param('action');
  if (!['plan', 'detect', 'run', 'stop'].includes(action)) return c.notFound();
  const body = await c.req.json();
  if (typeof body?.cwd !== 'string' || !body.cwd.trim()) return c.json({ error: 'cwd is required' }, 400);
  const runner = await project(body.cwd);
  if (runner.busy && action !== 'stop') return c.json({ error: 'Validation is busy' }, 409);
  switch (action) {
    case 'plan': await runner.configure(body.plan); break;
    case 'detect': await runner.detect(); break;
    case 'stop': await runner.stop(); break;
    case 'run': {
      if (body.caller === 'agent') return c.json(await runner.runForAgent());
      if (body.caller !== 'user') return c.json({ error: 'caller must be agent or user' }, 400);
      const run = await runner.run('user');
      return c.json({ id: run.id });
    }
  }
  return c.json(runner.snapshot());
});
