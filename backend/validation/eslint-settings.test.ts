import { expect, test } from 'bun:test';
import { orderedESLintBlocks, moveESLintBlock, editSettingsBlock, moveSettingsBlock, settingsBlocks } from '../../shared/eslint-plan';
import type { Plan } from '../../shared/contracts';

const plan: Plan = { groups: [['eslint:a'], ['eslint:b']], policies: {}, eslint: {
  a: [{ rules: { 'solid/reactivity': 'error' } }, { files: ['**/*.tsx'], settings: { solid: { version: 1 } } }, { settings: { solid: { version: 2 } } }],
  b: { rules: {} },
} };

test('settings blocks retain scope and can move between runs without mutating the original', () => {
  const moved = moveSettingsBlock(plan, 'a', 1, 'b');
  expect(settingsBlocks(moved.eslint!.b!)[0]!.value).toEqual({ files: ['**/*.tsx'], settings: { solid: { version: 1 } } });
  expect(settingsBlocks(plan.eslint!.a!)).toHaveLength(2);
  expect(settingsBlocks(moved.eslint!.a!)).toHaveLength(1);
});

test('settings blocks can be added, edited, reordered and removed', () => {
  const added = editSettingsBlock(plan, 'b', null, { settings: { solid: { version: 2 } } });
  const edited = editSettingsBlock(added, 'b', 1, { settings: { solid: { version: 1 } } });
  expect(settingsBlocks(edited.eslint!.b!)[0]!.value.settings).toEqual({ solid: { version: 1 } });
  const reordered = moveSettingsBlock(plan, 'a', 2, 'a', 1);
  expect(settingsBlocks(reordered.eslint!.a!)[0]!.value.settings).toEqual({ solid: { version: 2 } });
  expect(settingsBlocks(moveSettingsBlock(edited, 'b', 1, null).eslint!.b!)).toHaveLength(0);
});

test('settings and rules share one ordered list and preserve scopes', () => {
  const original: Plan = { ...plan, eslint: { a: [{ files: ['**/*.tsx'], rules: { first: 'error', second: 'warn' } }, { settings: { solid: { version: 2 } } }] } };
  expect(orderedESLintBlocks(original.eslint!.a!)).toHaveLength(3);
  const moved = moveESLintBlock(original, 'a', 2, 'a', 1);
  expect(orderedESLintBlocks(moved.eslint!.a!)).toEqual([
    { files: ['**/*.tsx'], rules: { first: 'error' } },
    { settings: { solid: { version: 2 } } },
    { files: ['**/*.tsx'], rules: { second: 'warn' } },
  ]);
  expect(orderedESLintBlocks(original.eslint!.a!)[2]).toHaveProperty('settings');
});

test('settings blocks reject invalid settings and file-backed destinations', () => {
  expect(() => editSettingsBlock(plan, 'a', null, { settings: [] })).toThrow('settings must be an object');
  expect(() => editSettingsBlock(plan, 'a', null, { settings: {}, rules: {} })).toThrow('Settings blocks support');
  expect(() => moveSettingsBlock({ ...plan, eslint: { ...plan.eslint, b: { configFile: 'eslint.config.js' } } }, 'a', 1, 'b')).toThrow('read-only');
});
