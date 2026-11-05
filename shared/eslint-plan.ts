import { isESLintFileConfig, type ESLintConfig, type ESLintStepConfig, type Plan } from './contracts';

export function eslintStepName(key: string): string {
  return key === 'default' ? 'eslint' : `eslint:${key}`;
}

export function eslintConfigs(config: ESLintStepConfig): ESLintConfig[] {
  if (isESLintFileConfig(config)) { throw new Error('File-backed ESLint steps are read-only.'); }
  return Array.isArray(config) ? config : [config];
}

function rules(config: ESLintConfig): Record<string, unknown> {
  const value = config['rules'];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function assignedRules(config: ESLintStepConfig): string[] {
  if (isESLintFileConfig(config)) { return []; }
  return [...new Set(eslintConfigs(config).flatMap(item => Object.keys(rules(item))))].sort();
}

export function ruleSettings(config: ESLintStepConfig, id: string): unknown[] {
  return eslintConfigs(config).filter(item => Object.hasOwn(rules(item), id)).map(item => rules(item)[id]);
}

// Move every override of a rule together, retaining native settings and its block's scope.
export function moveESLintRule(original: Plan, id: string, from: string | null, to: string | null): Plan {
  if (from === to) { return original; }
  const plan = structuredClone(original);
  const entries = plan.eslint ?? {};
  if (from !== null && !Object.hasOwn(entries, from)) { throw new Error('Source ESLint step no longer exists.'); }
  if (to !== null && !Object.hasOwn(entries, to)) { throw new Error('Destination ESLint step no longer exists.'); }
  if ([from, to].some(key => key !== null && isESLintFileConfig(entries[key]!))) { throw new Error('File-backed ESLint steps are read-only.'); }
  if (to !== null && assignedRules(entries[to]!).includes(id)) { throw new Error(`${id} is already configured in ${eslintStepName(to)}.`); }

  const moved: ESLintConfig[] = [];
  if (from !== null) {
    for (const config of eslintConfigs(entries[from]!)) {
      if (!Object.hasOwn(rules(config), id)) { continue; }
      moved.push({ ...structuredClone(config), rules: { [id]: rules(config)[id] } });
      delete rules(config)[id];
    }
    if (!moved.length) { return original; }
  } else {
    if (Object.values(entries).some(config => assignedRules(config).includes(id))) { throw new Error('Rule is already assigned; move it from its current step.'); }
    moved.push({ rules: { [id]: 'error' } });
  }

  if (to !== null) { entries[to] = [...eslintConfigs(entries[to]!), ...moved]; }
  return plan;
}

export function setESLintRule(original: Plan, key: string, id: string, override: number, value: unknown): Plan {
  const severity = Array.isArray(value) ? value[0] : value;
  if (![0, 1, 2, 'off', 'warn', 'error'].includes(severity as string | number)) { throw new Error('Use an ESLint severity or an array starting with one.'); }
  const plan = structuredClone(original);
  const config = plan.eslint?.[key];
  if (!config) { throw new Error('ESLint step no longer exists.'); }
  const matches = eslintConfigs(config).filter(item => Object.hasOwn(rules(item), id));
  if (!matches[override]) { throw new Error('Rule override no longer exists.'); }
  rules(matches[override]!)[id] = value;
  return plan;
}

export function addESLintStep(original: Plan, name: string, configFile?: string): Plan {
  const key = name.trim();
  if (!key || key.includes(':')) { throw new Error('Choose a non-empty step name without a colon.'); }
  if (Object.hasOwn(original.eslint ?? {}, key)) { throw new Error('An ESLint step with that name already exists.'); }
  if (configFile !== undefined && !configFile.trim()) { throw new Error('Choose an ESLint config file path.'); }
  const reference = eslintStepName(key);
  if (original.groups.flat().includes(reference) || Object.hasOwn(original.policies, reference)) { throw new Error('That analysis step name is already in use.'); }
  return {
    ...original,
    eslint: { ...original.eslint, [key]: configFile === undefined ? { rules: {} } : { configFile: configFile.trim() } },
    groups: [...original.groups, [reference]],
    policies: { ...original.policies, [reference]: 'agent' },
  };
}
