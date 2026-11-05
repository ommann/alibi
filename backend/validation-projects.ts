import { resolve } from 'node:path';
import { Validation } from './validation/core';

// HTTP and RPC share one runner per project, including during initialization.
const projects = new Map<string, Promise<Validation>>();

export function project(cwd: string): Promise<Validation> {
  const path = resolve(cwd);
  let pending = projects.get(path);
  if (!pending) {
    pending = Validation.create(path);
    projects.set(path, pending);
    pending.catch(() => projects.delete(path));
  }
  return pending;
}
