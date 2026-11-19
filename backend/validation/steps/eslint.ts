import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid';
import perfectionist from 'eslint-plugin-perfectionist';
import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { isESLintFileConfig, type ESLintStepConfig } from '../../../shared/contracts.ts';
import { sourceFiles } from '../source-files.ts';
import type { Context, Step } from '../step.ts';

export async function engine(context: Context) {
  const config = context.instanceConfig as ESLintStepConfig | undefined;
  if (config && isESLintFileConfig(config)) {
    const path = resolve(context.cwd, config.configFile);
    if (!(await stat(path).catch(() => null))?.isFile()) {
      throw new Error(`ESLint config file not found: ${config.configFile}`);
    }
    return new ESLint({ cwd: context.cwd, overrideConfigFile: path });
  }
  const configs = (Array.isArray(config) ? config : [config ?? {}]) as Linter.Config[];
  return new ESLint({
    cwd: context.cwd,
    overrideConfigFile: true,
    overrideConfig: configs.map(item => {
      // Global ignores must remain standalone in flat config.
      if (Object.keys(item).length && Object.keys(item).every(key => ['name', 'ignores'].includes(key))) { return item; }
      return {
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
        ...item,
        plugins: { '@typescript-eslint': tseslint.plugin, solid, perfectionist, ...item.plugins },
        languageOptions: {
          parser: tseslint.parser,
          ...item.languageOptions,
          parserOptions: { tsconfigRootDir: context.cwd, ecmaFeatures: { jsx: true }, ...(item.languageOptions?.parserOptions as Linter.ParserOptions | undefined) },
        },
      };
    }),
  });
}

export default {
  name: 'eslint',
  instances: true,
  async detect(context) {
    const eslint = await engine(context);
    for await (const file of sourceFiles(context.cwd)) {
      context.signal?.throwIfAborted();
      if (!await eslint.isPathIgnored(join(context.cwd, file))) { return true; }
    }
    return false;
  },
  async run(context) {
    const eslint = await engine(context);
    const formatter = await eslint.loadFormatter('stylish');
    const diagnostics: ESLint.LintResult[] = [];
    let files = 0;
    let errors = 0;
    let warnings = 0;
    const counts: Record<string, number> = {};
    for await (const file of sourceFiles(context.cwd)) {
      context.signal?.throwIfAborted();
      const path = join(context.cwd, file);
      if (await eslint.isPathIgnored(path)) { continue; }
      const config = await eslint.calculateConfigForFile(path);
      for (const [rule, setting] of Object.entries(config?.rules ?? {})) {
        const severity = Array.isArray(setting) ? setting[0] : setting;
        if (severity === 2 || severity === 'error') counts[rule] ??= 0;
      }
      const results = await eslint.lintText(await Bun.file(path).text(), { filePath: path });
      context.signal?.throwIfAborted();
      for (const result of results) {
        files++;
        errors += result.errorCount;
        for (const message of result.messages) {
          if (message.severity === 2 && message.ruleId) counts[message.ruleId] = (counts[message.ruleId] ?? 0) + 1;
        }
        warnings += result.warningCount;
        if (result.messages.length) { diagnostics.push(result); }
      }
    }
    context.signal?.throwIfAborted();
    context.eslintCounts?.(counts);
    if (diagnostics.length) { context.output?.('stdout', await formatter.format(diagnostics)); }
    const summary = files === 0 ? 'No matching files.'
      : `Checked ${files} ${files === 1 ? 'file' : 'files'}. ${errors || warnings
        ? `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}.`
        : 'No issues found.'}`;
    context.output?.('stdout', `${summary}\n`);
    return errors ? 1 : 0;
  },
} satisfies Step;
