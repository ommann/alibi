import { dirname, join } from "node:path";
import { runCommand, type Context } from "./step.ts";

const managers = new Set(["npm", "pnpm", "yarn", "bun"]);
const lockfiles = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
] as const;

export async function packageManager(cwd: string): Promise<string> {
  let directory = cwd;
  while (true) {
    const manifest = Bun.file(join(directory, "package.json"));
    if (await manifest.exists()) {
      const metadata = await manifest.json();
      if (metadata.packageManager !== undefined) {
        const manager = typeof metadata.packageManager === "string"
          ? metadata.packageManager.split("@")[0]!
          : "";
        if (!managers.has(manager)) {
          throw new Error(`Unsupported packageManager in ${manifest.name}: ${metadata.packageManager}`);
        }
        return manager;
      }
    }

    const detected = new Set<string>();
    for (const [file, manager] of lockfiles) {
      if (await Bun.file(join(directory, file)).exists()) {
        detected.add(manager);
      }
    }
    if (detected.size > 1) {
      throw new Error(`Conflicting package manager lockfiles in ${directory}; set packageManager in package.json.`);
    }
    if (detected.size === 1) {
      return [...detected][0]!;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return "npm";
    }
    directory = parent;
  }
}

export async function runPackageScript(context: Context, script: string): Promise<number> {
  const manager = await packageManager(context.cwd);
  return runCommand(context, [manager, "run", script]);
}
