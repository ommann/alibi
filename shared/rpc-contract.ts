import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import type { Snapshot } from './contracts';

const policy = z.enum(['agent', 'user', 'off']);
const record = z.record(z.string(), z.unknown());
const plan = z.object({
  groups: z.array(z.array(z.string())),
  policies: z.record(z.string(), policy),
  removed: z.array(z.string()).optional(),
  options: z.object({ useNix: z.boolean().optional(), runsFirst: z.boolean().optional(), newestRunsFirst: z.boolean().optional(), hideDeprecatedESLintRules: z.boolean().optional() }).optional(),
  configs: z.record(z.string(), record).optional(),
  eslint: z.record(z.string(), z.union([record, z.array(record)])).optional(),
});
const snapshot: z.ZodType<Snapshot> = z.object({
  cwd: z.string(), busy: z.boolean(), running: z.boolean().optional(), stopping: z.boolean().optional(), plan,
  steps: z.array(z.object({
    name: z.string(),
    parameters: z.record(z.string(), z.object({ type: z.literal('number'), label: z.string(), default: z.number(), min: z.number().optional(), max: z.number().optional(), step: z.number().optional() })),
    detection: z.object({ applicable: z.boolean(), error: z.string().optional(), checkedAt: z.string() }).nullable(),
  })),
  runs: z.array(z.object({
    id: z.string(), caller: z.enum(['agent', 'user']), cancelled: z.boolean().optional(), startedAt: z.string(), agentFinishedAt: z.string().optional(), finishedAt: z.string().optional(), plan,
    results: z.array(z.object({
      name: z.string(), policy, status: z.enum(['pending', 'running', 'passed', 'failed', 'skipped', 'cancelled']), output: z.string(), reason: z.string().optional(), exitCode: z.number().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(),
    })),
  })),
});

export const validationContract = {
  configure: oc.input(z.object({ cwd: z.string().trim().min(1), plan })).output(snapshot),
  run: oc.input(z.object({ cwd: z.string().trim().min(1) })).output(z.object({ id: z.string() })),
  stop: oc.input(z.object({ cwd: z.string().trim().min(1) })).output(snapshot),
  watch: oc.input(z.object({ cwd: z.string().trim().min(1) })).output(eventIterator(snapshot)),
};
