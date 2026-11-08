import { resolve, join, isAbsolute } from "node:path";
import { stat, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Context, Step } from "./step.ts";
import { workspaceTests } from './workspace-tests.ts';

import type { Plan, Detection, Run, Snapshot } from "../../shared/contracts.ts";

export type { Policy, Plan, Detection, Result, Run } from "../../shared/contracts.ts";
export type AgentReport = { exitCode: number; cancelled?: boolean; failures: { name: string; output: string; exitCode: number }[] };

const now = () => new Date().toISOString();

export async function loadSteps(directory = join(import.meta.dir, "steps")): Promise<Step[]> {
  const files = await Array.fromAsync(new Bun.Glob("*.ts").scan({ cwd: directory }));
  files.sort();

  const steps: Step[] = [];

  for (const file of files) {
    const { default: step } = await import(pathToFileURL(join(directory, file)).href);
    if (!step || typeof step.name !== "string" || typeof step.detect !== "function" || typeof step.run !== "function") {
      throw new Error(`Invalid step module: ${file}`);
    }

    if (steps.some(existing => existing.name === step.name)) { throw new Error(`Duplicate step: ${step.name}`); }
    steps.push(step);
  }

  return steps;
}

function configuredSteps(plan: unknown, definitions: Step[]): Step[] {
  return definitions.flatMap(step => {
    if (!step.instances) { return [step]; }
    const entries = (plan as Record<string, unknown>)?.[step.name];
    if (entries === undefined) { return []; }
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) { throw new Error(`${step.name} must be an object`); }
    return Object.entries(entries).map(([name, config]) => {
      if (!name.trim() || name.includes(":")) { throw new Error(`Invalid ${step.name} instance name: ${name}`); }
      const configs = Array.isArray(config) ? config : [config];
      if (!configs.length || configs.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
        throw new Error(`${step.name}:${name} must contain a configuration object or non-empty array of objects`);
      }
      if (step.name === "eslint") {
        for (const item of configs) {
          if (!Object.hasOwn(item, "configFile")) { continue; }
          const path = (item as { configFile: unknown }).configFile;
          if (Array.isArray(config) || Object.keys(item).length !== 1 || typeof path !== "string" || !path.trim() || isAbsolute(path)) {
            throw new Error(`${step.name}:${name}.configFile must be a non-empty project-relative path, without inline configuration`);
          }
        }
      }
      const instanceConfig = structuredClone(config);
      return {
        ...step, name: name === "default" ? step.name : `${step.name}:${name}`,
        detect: context => step.detect({ ...context, instanceConfig }),
        run: context => step.run({ ...context, instanceConfig }),
      } satisfies Step;
    });
  });
}

export function checkPlan(value: unknown, definitions: Step[]): Plan {
  let plan = value as Plan & { useNix?: boolean };

  if (!plan || !Array.isArray(plan.groups) || !plan.policies || typeof plan.policies !== "object" || Array.isArray(plan.policies)) {
    throw new Error("Plan must contain groups and policies");
  }

  if (plan.groups.some(group => !Array.isArray(group) || group.length === 0)) {
    throw new Error("Groups must be non-empty arrays");
  }

  // Migrate workspace analyses created by older versions back to their dispatcher.
  const legacy = (name: string) => name.startsWith('npm:test:');
  if (definitions.some(step => step.name === 'npm:test') &&
    [...plan.groups.flat(), ...Object.keys(plan.policies), ...(plan.removed ?? [])].some(legacy)) {
    plan = structuredClone(plan);
    const selected = plan.groups.flat().filter(legacy);
    plan.policies['npm:test'] ??= plan.policies[selected[0] ?? ''] ?? 'agent';
    let seen = false;
    plan.groups = plan.groups.map(group => group.flatMap(name => {
      if (name !== 'npm:test' && !legacy(name)) return [name];
      if (seen) return [];
      seen = true;
      return ['npm:test'];
    })).filter(group => group.length);
    if (plan.removed) {
      const removed = plan.removed.some(legacy);
      plan.removed = plan.removed.filter(name => !legacy(name));
      if (removed && !seen && !plan.removed.includes('npm:test')) plan.removed.push('npm:test');
    }
    for (const name of Object.keys(plan.policies).filter(legacy)) delete plan.policies[name];
  }
  const steps = configuredSteps(plan, definitions);
  if (new Set(steps.map(step => step.name)).size !== steps.length) { throw new Error("Duplicate analysis step name"); }

  if (plan.useNix !== undefined && typeof plan.useNix !== "boolean") { throw new Error("useNix must be a boolean"); }

  if (plan.options !== undefined) {
    if (!plan.options || typeof plan.options !== "object" || Array.isArray(plan.options)) { throw new Error("options must be an object"); }
    for (const [key, value] of Object.entries(plan.options)) {
      if (!["useNix", "runsFirst", "newestRunsFirst", "hideDeprecatedESLintRules"].includes(key)) { throw new Error(`Unknown option: ${key}`); }
      if (typeof value !== "boolean") { throw new Error(`options.${key} must be a boolean`); }
    }
  }

  const names = new Set(steps.map(step => step.name));
  const removed = plan.removed ?? [];
  if (!Array.isArray(removed) || removed.some(name => !names.has(name)) || new Set(removed).size !== removed.length) {
    throw new Error("Removed steps must be unique known step names");
  }

  const seen = new Set<string>();
  for (const group of plan.groups) {
    if (!Array.isArray(group) || group.length === 0) { throw new Error("Groups must be non-empty arrays"); }
    for (const name of group) {
      if (!names.has(name)) { throw new Error(`Unknown step: ${name}`); }
      if (removed.includes(name)) { throw new Error(`Removed step is still in a group: ${name}`); }
      if (seen.has(name)) { throw new Error(`Repeated step: ${name}`); }
      seen.add(name);
    }
  }

  for (const [name, policy] of Object.entries(plan.policies)) {
    if (!names.has(name)) { throw new Error(`Unknown step: ${name}`); }
    if (!["agent", "user", "off"].includes(policy)) { throw new Error(`Invalid policy: ${policy}`); }
  }

  const rawConfigs = plan.configs ?? {};
  if (!rawConfigs || typeof rawConfigs !== "object" || Array.isArray(rawConfigs)) { throw new Error("configs must be an object"); }

  const configs: Record<string, Record<string, unknown>> = {};

  for (const step of steps) {
    const parameters = step.parameters ?? {};
    const raw = rawConfigs[step.name] ?? {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { throw new Error(`Config for ${step.name} must be an object`); }

    const config: Record<string, unknown> = {};
    for (const [key, parameter] of Object.entries(parameters)) {
      const value = (raw as Record<string, unknown>)[key] ?? parameter.default;
      if (typeof value !== "number" || !Number.isFinite(value)) { throw new Error(`${step.name}.${key} must be a number`); }
      if (parameter.min !== undefined && value < parameter.min) { throw new Error(`${step.name}.${key} is below minimum`); }
      if (parameter.max !== undefined && value > parameter.max) { throw new Error(`${step.name}.${key} is above maximum`); }
      config[key] = value;
    }

    if (Object.keys(config).length) { configs[step.name] = config; }
  }

  return {
    ...Object.fromEntries(definitions.filter(step => step.instances && Object.hasOwn(plan, step.name))
      .map(step => [step.name, structuredClone((plan as unknown as Record<string, unknown>)[step.name])])),
    groups: [...plan.groups.map(group => [...group]), ...steps.filter(step => !seen.has(step.name) && !removed.includes(step.name)).map(step => [step.name])],
    policies: Object.fromEntries(steps.map(step => [step.name, plan.policies[step.name] ?? "agent"])),
    removed: [...removed],
    options: { ...plan.options, useNix: plan.options?.useNix ?? plan.useNix ?? false },
    configs,
  };
}

export function agentReport(run: Run): AgentReport {
  const failures = run.results.filter(result => result.policy === "agent" && result.status === "failed")
    .map(result => ({ name: result.name, output: result.output, exitCode: result.exitCode ?? 1 }));

  return { exitCode: run.cancelled ? 130 : failures[0]?.exitCode ?? 0, failures, ...(run.cancelled ? { cancelled: true } : {}) };
}

export class Validation {
  readonly cwd: string;
  private readonly definitions: Step[];
  private workspaceSteps: Step[] = [];
  get steps(): Step[] { return configuredSteps(this.plan, this.definitions); }
  plan: Plan;
  detections: Record<string, Detection> = {};
  runs: Run[] = [];
  busy = false;
  private configFile?: string;
  private controller?: AbortController;
  private runDone?: Promise<void>;

  private constructor(cwd: string, steps: Step[], plan: Plan, configFile?: string) {
    this.cwd = cwd;
    this.definitions = steps;
    this.plan = plan;
    this.configFile = configFile;
  }

  static async create(cwd: string, options: { steps?: Step[]; persist?: boolean } = {}) {
    cwd = resolve(cwd);
    if (!(await stat(cwd)).isDirectory()) { throw new Error(`Not a directory: ${cwd}`); }

    const steps = options.steps ?? await loadSteps();
    const configFile = options.persist === false ? undefined : join(cwd, ".alibi.json");
    let plan = checkPlan({ groups: [], policies: {} }, steps);
    if (configFile && await Bun.file(configFile).exists()) {
      plan = checkPlan(await Bun.file(configFile).json(), steps);
    }

    const runner = new Validation(cwd, steps, plan, configFile);
    if (!options.steps) runner.workspaceSteps = await workspaceTests(cwd);
    return runner;
  }

  snapshot(): Snapshot {
    return { cwd: this.cwd, busy: this.busy, running: !!this.controller, stopping: this.controller?.signal.aborted ?? false, plan: this.plan, steps: this.steps.map(step => ({ name: step.name, parameters: step.parameters ?? {}, detection: this.detections[step.name] ?? null })), runs: this.runs };
  }

  async refreshConfig() {
    if (this.busy) { throw new Error("Validation is busy"); }
    if (!this.configFile) { throw new Error("No configuration file configured"); }

    this.busy = true;
    try {
      const plan = checkPlan(await Bun.file(this.configFile).json(), this.definitions);
      this.plan = plan;
      this.detections = {};
    } finally { this.busy = false; }
  }

  async configure(value: unknown) {
    if (this.busy) { throw new Error("Validation is busy"); }

    const plan = checkPlan(value, this.definitions);
    // Layout, reporting policies, and UI options do not change applicability.
    const detectionInputs = (value: Plan) => JSON.stringify([
      value.configs ?? {}, value.options?.useNix ?? false,
      this.definitions.filter(step => step.instances).map(step =>
        (value as unknown as Record<string, unknown>)[step.name] ?? null),
    ]);
    const invalidateDetections = detectionInputs(plan) !== detectionInputs(this.plan);
    this.busy = true;
    try {
      if (this.configFile) {
        await Bun.write(this.configFile + ".tmp", JSON.stringify(plan, null, 2) + "\n");
        await rename(this.configFile + ".tmp", this.configFile);
      }

      this.plan = plan;
      if (invalidateDetections) { this.detections = {}; }
    } finally { this.busy = false; }
  }

  private async context(): Promise<Context> {
    const file = Bun.file(join(this.cwd, "package.json"));
    const pkg = await file.exists() ? await file.json() : {};

    return { cwd: this.cwd, scripts: pkg?.scripts ?? {} };
  }

  private async detectWith(context: Context, names?: string[], steps = this.steps) {
    for (const step of steps.filter(step => !names || names.includes(step.name))) {
      context.signal?.throwIfAborted();

      try {
        this.detections[step.name] = { applicable: await step.detect({ ...context, config: this.plan.configs?.[step.name] ?? {} }), checkedAt: now() };
      } catch (error) {
        this.detections[step.name] = { applicable: false, error: String(error), checkedAt: now() };
      }
    }
  }

  async detect() {
    if (this.busy) { throw new Error("Validation is busy"); }
    this.busy = true;
    try { await this.detectWith(await this.context()); }
    finally { this.busy = false; }

    return this.detections;
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.runDone;
  }

  async runForAgent(onStep?: (name: string) => void): Promise<AgentReport> {
    const ready = Promise.withResolvers<AgentReport>();
    // The full run keeps ownership of the busy flag, cancellation, and UI results.
    void this.execute("agent", run => ready.resolve(agentReport(run)), onStep)
      .then(run => ready.resolve(agentReport(run)), ready.reject);
    return ready.promise;
  }

  async run(caller: "agent" | "user" = "agent"): Promise<Run> {
    return this.execute(caller);
  }

  async runValidation(selection: { analysis?: string; group?: number } = {}): Promise<Run> {
    if (selection.analysis !== undefined && selection.group !== undefined) throw new Error('Select an analysis or a group, not both.');
    if (selection.group !== undefined) {
      const group = this.plan.groups[selection.group - 1];
      if (!group) throw new Error(`Unknown analysis group: ${selection.group}`);
      return this.execute('assistant', undefined, undefined, group);
    }
    if (selection.analysis !== undefined) {
      if (!this.steps.some(step => step.name === selection.analysis)) throw new Error(`Unknown analysis: ${selection.analysis}`);
      return this.execute('assistant', undefined, undefined, [selection.analysis]);
    }
    return this.execute('assistant', undefined, undefined, this.plan.groups.flat());
  }

  async runESLintRule(rule: string): Promise<Run> {
    const definition = this.definitions.find(step => step.name === 'eslint');
    if (!definition) throw new Error('ESLint is unavailable.');
    const name = `eslint:rule:${rule}`;
    const instanceConfig = { rules: { [rule]: 'error' } };
    const step: Step = {
      name,
      detect: context => definition.detect({ ...context, instanceConfig }),
      run: context => definition.run({ ...context, instanceConfig }),
    };
    return this.execute('assistant', undefined, undefined, [name], [step]);
  }

  async runESLint(names: string[]): Promise<Run> {
    if (!names.length) { throw new Error('Select at least one ESLint analysis.'); }
    const available = new Set(this.steps.map(step => step.name));
    for (const name of names) {
      if (!(name === 'eslint' || name.startsWith('eslint:')) || !available.has(name)) {
        throw new Error(`Unknown ESLint analysis: ${name}`);
      }
    }
    return this.execute('assistant', undefined, undefined, [...new Set(names)]);
  }

  private async execute(caller: Run['caller'], agentReady?: (run: Run) => void, onStep?: (name: string) => void, names?: string[], temporarySteps?: Step[]): Promise<Run> {
    if (this.busy) { throw new Error("Validation is busy"); }
    this.busy = true;
    const controller = new AbortController();
    const { signal } = controller;
    const done = Promise.withResolvers<void>();
    this.controller = controller;
    this.runDone = done.promise;

    const plan = structuredClone(this.plan);
    if (names) {
      const grouped = new Set(plan.groups.flat());
      plan.groups = [
        ...plan.groups.map(group => group.filter(name => names.includes(name))).filter(group => group.length),
        ...names.filter(name => !grouped.has(name)).map(name => [name]),
      ];
      plan.policies = Object.fromEntries(names.map(name => [name, 'user' as const]));
    }
    const steps = temporarySteps ?? this.steps.flatMap(step => step.name === 'npm:test' && this.workspaceSteps.length ? this.workspaceSteps : [step]);
    if (this.workspaceSteps.length) {
      plan.groups = plan.groups.flatMap(group => {
        if (!group.includes('npm:test')) return [group];
        const rest = group.filter(name => name !== 'npm:test');
        return [...(rest.length ? [rest] : []), ...this.workspaceSteps.map(step => [step.name])];
      });
      for (const step of this.workspaceSteps) plan.policies[step.name] = plan.policies['npm:test']!;
      delete plan.policies['npm:test'];
    }
    const run: Run = {
      id: crypto.randomUUID(), caller, startedAt: now(), plan,
      results: plan.groups.flat().map(name => ({ name, policy: plan.policies[name]!, status: "pending", output: "" })),
    };

    try {
      const context = { ...await this.context(), signal };
      signal.throwIfAborted();
      await this.detectWith(context, names, steps);
      signal.throwIfAborted();

      for (const result of run.results) {
        const detection = this.detections[result.name]!;

        if (result.policy === "off" || (!detection.applicable && !detection.error)) {
          result.status = "skipped";
          result.reason = result.policy === "off" ? "Disabled" : "Not applicable";
        }
      }

      this.runs.push(run);

      const notifyAgent = () => {
        if (caller === "agent" && !signal.aborted && run.results.every(result => result.policy !== "agent"
          || !["pending", "running"].includes(result.status))) {
          run.agentFinishedAt ??= now();
          agentReady?.(run);
        }
      };
      notifyAgent();

      let blocked = false;
      for (const group of plan.groups) {
        const executions = group.map(async name => {
          const result = run.results.find(result => result.name === name)!;
          const detection = this.detections[name]!;

          if (result.status === "skipped") { return; }

          if (signal.aborted) {
            result.status = "cancelled";
            return;
          }

          if (blocked) {
            result.status = "skipped";
            result.reason = "Earlier agent-visible failure";
            return;
          }

          result.status = "running";
          result.startedAt = now();

          try {
            if (detection.error) { throw new Error(detection.error); }
            const step = steps.find(step => step.name === name)!;
            onStep?.(name);
            result.exitCode = await step.run({ ...context, useNix: plan.options?.useNix, config: plan.configs?.[name] ?? {}, output: (_stream, text) => { result.output += text; } });
            result.status = signal.aborted ? "cancelled" : result.exitCode === 0 ? "passed" : "failed";
            if (signal.aborted) { result.exitCode = undefined; }
          } catch (error) {
            if (!signal.aborted) { result.output += `${String(error)}\n`; }
            result.status = signal.aborted ? "cancelled" : "failed";
            result.exitCode = signal.aborted ? undefined : 1;
          } finally { result.finishedAt = now(); }
        });

        const agentCompletion = Promise.all(executions.filter((_execution, index) => plan.policies[group[index]!] === "agent"))
          .then(() => {
            // Settle later agent checks as soon as this section's agent results are known.
            // User-facing checks still finish before the next section starts.
            if (caller === "agent" && run.results.some(result => result.policy === "agent" && result.status === "failed")) {
              blocked = true;
              for (const result of run.results) {
                if (result.policy === "agent" && result.status === "pending") {
                  result.status = "skipped";
                  result.reason = "Earlier agent-visible failure";
                }
              }
            }
            notifyAgent();
          });
        await Promise.all([...executions, agentCompletion]);
      }
    } catch (error) {
      for (const result of run.results) {
        if (result.status !== "pending") { continue; }
        result.status = result.policy === "off" ? "skipped" : signal.aborted ? "cancelled" : "failed";
        result.reason = result.policy === "off" ? "Disabled" : undefined;
        result.exitCode = result.policy === "off" || signal.aborted ? undefined : 1;
        if (result.policy !== "off" && !signal.aborted) { result.output = `${String(error)}\n`; }
      }
    } finally {
      if (!this.runs.includes(run)) { this.runs.push(run); }
      if (signal.aborted) { run.cancelled = true; }
      run.finishedAt = now();
      if (caller === "agent") { run.agentFinishedAt ??= run.finishedAt; }
      this.busy = false;
      this.controller = undefined;
      this.runDone = undefined;
      done.resolve();
    }

    return run;
  }
}
