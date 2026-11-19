import { join, relative } from 'node:path';
import { isESLintFileConfig, type Plan } from '../../shared/contracts';
import { assignedRules } from '../../shared/eslint-plan';
import { scopedEngine } from './nibble-fix';
import { sourceFiles } from './source-files';

export type NibbleError = { file: string; line: number; column: number; rule: string; message: string; fixable: boolean; group: string; checkCommand?: string; fixCommand?: string };

export async function nibbleErrors(cwd: string, plan: Plan, onCounts?: (counts: Record<string, number>) => void, options: { countsOnly?: boolean; signal?: AbortSignal } = {}): Promise<NibbleError[]> {
  const settings = plan.nibble;
  if (!settings || !settings.rules.length || (!options.countsOnly && (!settings.budget || !settings.reserve))) return [];
  options.signal?.throwIfAborted();
  const dirty = new Set<string>();
  if (settings.dirtyFilesFirst) {
    const process = Bun.spawn(['git', 'ls-files', '-z', '--modified', '--others', '--exclude-standard'], { cwd, stdout: 'pipe', stderr: 'ignore' });
    const output = await new Response(process.stdout).text();
    if (await process.exited !== 0) throw new Error('Could not determine dirty files.');
    for (const file of output.split('\0')) dirty.add(file);
  }
  const errors: NibbleError[] = [];
  const seen = new Set<string>();
  for (const [group, instanceConfig] of Object.entries(plan.eslint ?? {})) {
    if (!isESLintFileConfig(instanceConfig) && !assignedRules(instanceConfig).some(rule => settings.rules.includes(rule))) continue;

    for await (const file of sourceFiles(cwd)) {
      options.signal?.throwIfAborted();
      if (settings.dirtyFilesFirst && !dirty.has(file)) continue;
      const path = join(cwd, file);
      const eslint = await scopedEngine(cwd, instanceConfig, path, settings.rules);
      if (!eslint) continue;
      const results = await eslint.lintText(await Bun.file(path).text(), { filePath: path });
      for (const result of results) for (const message of result.messages) {
        if (message.severity !== 2 || !message.ruleId) continue;
        const error = { file: relative(cwd, result.filePath), line: message.line, column: message.column, rule: message.ruleId, message: message.message, fixable: !!message.fix, group };
        const key = JSON.stringify(error);
        if (!seen.has(key)) {
          seen.add(key);
          if (settings.rules.includes(error.rule)) errors.push(error);
        }
      }
    }
  }
  const counts = Object.fromEntries(settings.rules.map(rule => [rule, 0]));
  for (const error of errors) counts[error.rule] = (counts[error.rule] ?? 0) + 1;
  options.signal?.throwIfAborted();
  onCounts?.(counts);
  if (options.countsOnly) return [];
  errors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  const selected: NibbleError[] = [];
  let lockedFile: string | undefined;
  while (errors.length && selected.length < Math.min(settings.budget!, settings.reserve!)) {
    let candidates = errors.filter(error => !lockedFile || error.file === lockedFile);
    if (!candidates.length) { lockedFile = undefined; candidates = errors; }
    const rule = settings.rules.find(rule => candidates.some(error => error.rule === rule));
    candidates = candidates.filter(error => error.rule === rule);
    const error = candidates[settings.randomSelection ? Math.floor(Math.random() * candidates.length) : 0]!;
    const findings = errors.filter(item => item.file === error.file && item.rule === error.rule);
    selected.push(...findings);
    for (let index = errors.length - 1; index >= 0; index--) {
      if (errors[index]!.file === error.file && errors[index]!.rule === error.rule) errors.splice(index, 1);
    }
    if (settings.wholeFilesFirst) lockedFile = error.file;
  }
  const quote = (value: string) => /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
  for (const error of selected) {
    const args = ['bun', join(import.meta.dir, 'nibble-fix.ts'), cwd, error.group, error.file, error.rule];
    error.checkCommand = args.map(quote).join(' ');
    if (error.fixable) error.fixCommand = [...args, '--fix'].map(quote).join(' ');
  }
  return selected;
}
