import { join } from 'node:path';
import { runCommand, type Step } from './step.ts';

// Only expand the standard npm workspace dispatcher, not arbitrary shell scripts.
export async function workspaceTests(cwd: string): Promise<Step[]> {
  const file = Bun.file(join(cwd, 'package.json'));
  if (!await file.exists()) return [];
  const pkg = await file.json();
  if (typeof pkg.scripts?.test !== 'string' || !/^npm run test --workspaces(?: --if-present)?$/.test(pkg.scripts.test.trim()) || !Array.isArray(pkg.workspaces)) return [];
  const optional = pkg.scripts.test.includes('--if-present');
  const paths = new Set<string>();
  for (const pattern of pkg.workspaces) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) throw new Error('Unsupported npm workspace pattern');
    const matches = await Array.fromAsync(new Bun.Glob(`${pattern.replace(/\/$/, '')}/package.json`).scan({ cwd, onlyFiles: true }));
    for (const path of matches.sort()) paths.add(path);
  }
  const steps: Step[] = [];
  for (const path of paths) {
    const workspace = await Bun.file(join(cwd, path)).json();
    if (optional && typeof workspace.scripts?.test !== 'string') continue;
    const selector = path.slice(0, -'/package.json'.length);
    const name = `npm:test:${workspace.name || selector}`;
    if (steps.some(step => step.name === name)) throw new Error(`Duplicate workspace test name: ${name}`);
    steps.push({
      name,
      expandedFrom: 'npm:test',
      detect: () => true,
      run: context => runCommand(context, ['npm', 'run', 'test', `--workspace=${selector}`]),
    });
  }
  return steps;
}
