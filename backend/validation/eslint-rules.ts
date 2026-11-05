import { builtinRules } from 'eslint/use-at-your-own-risk';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid';
import type { ESLintRule } from '../../shared/contracts.ts';

// Only advertise rules from the ESLint and plugin versions the runner actually supplies.
export function eslintRuleCatalog(): ESLintRule[] {
  const entries = [
    ...builtinRules.entries(),
    ...Object.entries(solid.rules).map(([name, rule]) => [`solid/${name}`, rule] as const),
    ...Object.entries(tseslint.plugin.rules).map(([name, rule]) => [`@typescript-eslint/${name}`, rule] as const),
  ];
  return entries.map(([id, rule]) => ({
    id,
    description: rule.meta?.docs?.description ?? '',
    url: rule.meta?.docs?.url,
    deprecated: Boolean(rule.meta?.deprecated),
    requiresTypeChecking: Boolean(rule.meta?.docs && 'requiresTypeChecking' in rule.meta.docs && rule.meta.docs.requiresTypeChecking),
  })).sort((a, b) => a.id.localeCompare(b.id));
}
