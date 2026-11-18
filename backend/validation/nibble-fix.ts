import { ESLint, type Linter } from 'eslint';

function reusableConfig(config: Linter.Config): Linter.Config {
  return Object.fromEntries(Object.entries({ files: ['**/*'], plugins: config.plugins, languageOptions: config.languageOptions, linterOptions: config.linterOptions, processor: config.processor, settings: config.settings, rules: config.rules }).filter(([, value]) => value !== undefined));
}
import { resolve } from 'node:path';
import { engine } from './steps/eslint';
import type { ESLintStepConfig } from '../../shared/contracts';

export async function scopedEngine(cwd: string, configuration: ESLintStepConfig, file: string, rules?: string[]) {
  const base = await engine({ cwd, scripts: {}, instanceConfig: configuration });
  if (await base.isPathIgnored(file)) return null;
  const config = await base.calculateConfigForFile(file);
  if (!config) return null;
  if (rules) config.rules = Object.fromEntries(Object.entries(config.rules ?? {}).map(([id, value]) => [id, rules.includes(id) ? value : 'off']));
  return new ESLint({ cwd, overrideConfigFile: true, overrideConfig: reusableConfig(config), fix: false });
}

if (import.meta.main) {
  const [cwd, group, file, ...options] = Bun.argv.slice(2);
  const fix = options.includes('--fix');
  const rules = options.filter(value => value !== '--fix');
  if (!cwd || !group || !file || !rules.length) throw new Error('Expected project, ESLint group, file, and rules.');
  const plan = await Bun.file(resolve(cwd, '.alibi.json')).json();
  const configuration = plan.eslint?.[group] as ESLintStepConfig | undefined;
  if (!configuration) throw new Error(`Unknown ESLint group: ${group}`);
  const path = resolve(cwd, file);
  const eslint = await scopedEngine(cwd, configuration, path, rules);
  if (!eslint) throw new Error('File is ignored by ESLint.');
  // Reuse the exact resolved configuration, enabling only automatic fixes.
  const config = await eslint.calculateConfigForFile(path);
  const fixer = new ESLint({ cwd: resolve(cwd), overrideConfigFile: true, overrideConfig: reusableConfig(config), fix });
  const results = await fixer.lintFiles([path]);
  if (fix) await ESLint.outputFixes(results);
  console.log(await (await fixer.loadFormatter('stylish')).format(results));
  process.exitCode = results.some(result => result.errorCount) ? 1 : 0;
}
