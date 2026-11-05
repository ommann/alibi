import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { ignoredDirectories } from "./source-files.ts";
import type { ESLintConfigFiles } from "../../shared/contracts.ts";

// Listing only: never import or execute a project's configuration during discovery.
export async function eslintConfigFiles(cwd: string, limits: {
  maxDirectories?: number; maxEntries?: number; maxDepth?: number; maxFiles?: number;
} = {}, signal?: AbortSignal): Promise<ESLintConfigFiles> {
  const { maxDirectories = 300, maxEntries = 20_000, maxDepth = 6, maxFiles = 100 } = limits;
  const queue = [{ path: "", depth: 0 }];
  const files: string[] = [];
  let truncated = false;
  let entries = 0;
  let visited = 0;
  const deadline = Date.now() + 1500;

  search: for (let index = 0; index < queue.length; index++) {
    signal?.throwIfAborted();
    if (visited++ >= maxDirectories || Date.now() >= deadline) { truncated = true; break; }
    const directory = queue[index]!;
    let handle;
    try {
      handle = await opendir(join(cwd, directory.path));
    } catch (error) {
      if (!directory.path) { throw error; }
      truncated = true;
      continue;
    }
    for await (const entry of handle) {
      signal?.throwIfAborted();
      if (++entries > maxEntries || Date.now() >= deadline) { truncated = true; break search; }
      const path = directory.path ? `${directory.path}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name) && ![".angular", ".cache", ".turbo"].includes(entry.name)) {
        if (directory.depth >= maxDepth) { truncated = true; }
        else { queue.push({ path, depth: directory.depth + 1 }); }
      } else if (entry.isFile() && /^eslint\.config\.(?:[cm]?js|[cm]?ts)$/.test(entry.name)) {
        files.push(path);
        if (files.length >= maxFiles) { truncated = true; break search; }
      }
      // Symlinks are deliberately not followed, including links outside the project.
    }
  }
  files.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return { files, truncated };
}
