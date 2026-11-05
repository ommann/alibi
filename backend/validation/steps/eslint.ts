import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid";
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isESLintFileConfig, type ESLintStepConfig } from "../../../shared/contracts.ts";
import { sourceFiles } from "../source-files.ts";
import { runCommand, type Context, type Step } from "../step.ts";

async function fileCommand(context: Context): Promise<string[] | null> {
  const config = context.instanceConfig as ESLintStepConfig | undefined;
  if (!config || !isESLintFileConfig(config)) { return null; }
  const path = resolve(context.cwd, config.configFile);
  if (!(await stat(path).catch(() => null))?.isFile()) {
    throw new Error(`ESLint config file not found: ${config.configFile}`);
  }
  const require = createRequire(join(context.cwd, "package.json"));
  let packagePath: string;
  try {
    packagePath = require.resolve("eslint/package.json");
  } catch {
    throw new Error("File-backed steps require ESLint installed in the validated project.");
  }
  return ["node", join(dirname(packagePath), "bin", "eslint.js"), "--config", path, "."];
}

function engine(context: Context) {
  const config = context.instanceConfig as Linter.Config | Linter.Config[];
  const configs = Array.isArray(config) ? config : [config ?? {}];
  return new ESLint({
    cwd: context.cwd,
    overrideConfigFile: true,
    overrideConfig: configs.map(item => {
      // Global ignore entries must remain standalone in ESLint flat config.
      if (Object.keys(item).length && Object.keys(item).every(key => ["name", "ignores"].includes(key))) { return item; }
      return {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
        ...item,
        plugins: { "@typescript-eslint": tseslint.plugin, solid, ...item.plugins },
        languageOptions: {
          parser: tseslint.parser,
          ...item.languageOptions,
          parserOptions: { ecmaFeatures: { jsx: true }, ...item.languageOptions?.parserOptions },
        },
      };
    }),
  });
}

export default {
  name: "eslint",
  instances: true,
  async detect(context) {
    if (await fileCommand(context)) { return true; }
    const eslint = engine(context);
    for await (const file of sourceFiles(context.cwd)) {
      context.signal?.throwIfAborted();
      if (!await eslint.isPathIgnored(join(context.cwd, file))) { return true; }
    }
    return false;
  },
  async run(context) {
    const command = await fileCommand(context);
    if (command) { return runCommand(context, command); }
    const eslint = engine(context);
    const formatter = await eslint.loadFormatter("stylish");
    const diagnostics: ESLint.LintResult[] = [];
    let files = 0;
    let errors = 0;
    let warnings = 0;
    for await (const file of sourceFiles(context.cwd)) {
      context.signal?.throwIfAborted();
      const path = join(context.cwd, file);
      if (await eslint.isPathIgnored(path)) { continue; }
      const results = await eslint.lintText(await Bun.file(path).text(), { filePath: path });
      for (const result of results) {
        files++;
        errors += result.errorCount;
        warnings += result.warningCount;
        if (result.messages.length) { diagnostics.push(result); }
      }
    }
    if (diagnostics.length) {
      context.output?.("stdout", await formatter.format(diagnostics, { color: true }));
    }
    const summary = files === 0
      ? "No matching files."
      : `Checked ${files} ${files === 1 ? "file" : "files"}. ${errors || warnings
        ? `${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}.`
        : "No issues found."}`;
    context.output?.("stdout", `${summary}\n`);
    return errors ? 1 : 0;
  },
} satisfies Step;
