import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import eslint from './steps/eslint.ts';
import type { Context } from './step.ts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture(files: Record<string, string>, instanceConfig: unknown) {
  const cwd = await mkdtemp(join(tmpdir(), 'alibi-eslint-'));
  directories.push(cwd);
  for (const [name, text] of Object.entries(files)) { await Bun.write(join(cwd, name), text); }
  let output = '';
  const context: Context = { cwd, scripts: {}, instanceConfig, output: (_, text) => { output += text; } };
  return { context, output: () => output };
}

test('managed groups execute independently and report diagnostics', async () => {
  const f = await fixture({ 'index.js': 'debugger;\n' }, { rules: { 'no-debugger': 'error' } });
  expect(await eslint.detect(f.context)).toBe(true);
  expect(await eslint.run(f.context)).toBe(1);
  expect(f.output()).toContain('no-debugger');
  expect(f.output()).toContain('1 error');
  expect(await eslint.run({ ...f.context, instanceConfig: { rules: {} } })).toBe(0);
});

test('global ignores and scoped rules are respected', async () => {
  const f = await fixture({ 'skip.js': 'debugger;', 'index.ts': 'const value: number = 1;' }, [
    { ignores: ['skip.js'] },
    { files: ['**/*.ts'], rules: { 'no-debugger': 'error' } },
  ]);
  expect(await eslint.run(f.context)).toBe(0);
  expect(f.output()).toContain('Checked 1 file.');
  expect(await eslint.detect({ ...f.context, instanceConfig: [{ ignores: ['**/*'] }] })).toBe(false);
});

test('TypeScript and Solid plugins execute on TSX', async () => {
  const f = await fixture({ 'index.tsx': 'const unused: number = 1;\nconst view = <div style="color: red" />;' }, {
    rules: { '@typescript-eslint/no-unused-vars': 'error', 'solid/style-prop': 'error' },
  });
  expect(await eslint.run(f.context)).toBe(1);
  expect(f.output()).toContain('@typescript-eslint/no-unused-vars');
  expect(f.output()).toContain('solid/style-prop');
  expect(f.output()).not.toContain('Parsing error');
});

test('type-aware rules use configured parser services', async () => {
  const f = await fixture({
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['index.ts'] }),
    'index.ts': 'async function run() {}\nrun();',
  }, {
    languageOptions: { parserOptions: { project: './tsconfig.json' } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  });
  expect(await eslint.run(f.context)).toBe(1);
  expect(f.output()).toContain('@typescript-eslint/no-floating-promises');
  expect(f.output()).not.toContain('Parsing error');
});

test('warnings are reported without failing', async () => {
  const f = await fixture({ 'index.js': 'debugger;' }, { rules: { 'no-debugger': 'warn' } });
  expect(await eslint.run(f.context)).toBe(0);
  expect(f.output()).toContain('1 warning');
});

test('file-backed flat configuration runs through the SDK', async () => {
  const f = await fixture({
    'eslint.config.mjs': 'export default [{ files: ["index.js"], rules: { "no-debugger": "error" } }];',
    'index.js': 'debugger;',
  }, { configFile: 'eslint.config.mjs' });
  expect(await eslint.detect(f.context)).toBe(true);
  expect(await eslint.run(f.context)).toBe(1);
  expect(f.output()).toContain('no-debugger');
  await expect(eslint.detect({ ...f.context, instanceConfig: { configFile: 'missing.mjs' } })).rejects.toThrow('ESLint config file not found');
});

test('invalid rules fail rather than silently passing', async () => {
  const f = await fixture({ 'index.js': '' }, { rules: { 'nonexistent-rule': 'error' } });
  await expect(eslint.run(f.context)).rejects.toThrow();
});

test('aborted execution stops before linting', async () => {
  const f = await fixture({ 'index.js': 'debugger;' }, {});
  await expect(eslint.run({ ...f.context, signal: AbortSignal.abort() })).rejects.toThrow();
});
