import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RuleRow } from './rule-row';
import { JsonEditor } from '../shared/json-editor';
import { ViewNavigation } from '../shared/view-navigation';
import { Checkbox } from '../shared/checkbox';
import { DragDropModule, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { ValidationState } from '../core/validation-state';
import { isESLintFileConfig, type Plan } from '../../../../shared/contracts';
import { orderedESLintBlocks, moveESLintBlock, editSettingsBlock, moveSettingsBlock, settingsBlocks, addESLintStep, assignedRules, eslintStepName, moveESLintRule, ruleSettings, setESLintRule } from '../../../../shared/eslint-plan';

@Component({
  selector: 'app-eslint',
  imports: [ViewNavigation, Checkbox, DragDropModule, RuleRow, JsonEditor],
  templateUrl: './eslint.html',
  styleUrl: './eslint.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ESLint {
  readonly validation = inject(ValidationState);
  readonly search = signal('');
  readonly nameSearch = signal('');
  readonly addingGroup = signal(false);
  readonly newName = signal('');
  readonly configuration = signal('managed');
  readonly configFile = signal('');
  readonly unassigned = signal<string[]>([]);
  readonly error = signal('');

  constructor() {
    void this.validation.loadESLintRules();
  }

  readonly hideDeprecated = signal(true);
  readonly metadata = computed(() => new Map(this.validation.eslintRules().map(rule => [rule.id, rule])));

  readonly buckets = computed(() => {
    const plan = this.validation.state()?.plan;
    const entries = plan?.eslint ?? {};
    const assigned = new Set(Object.values(entries).flatMap(assignedRules));
    const query = this.search().trim().toLowerCase();
    const row = (id: string, settings: unknown[]) => ({ id, settings, metadata: this.metadata().get(id) });
    const available = [...new Set([...this.validation.eslintRules().map(rule => rule.id), ...this.unassigned()])]
      .filter(id => !assigned.has(id) && (!this.hideDeprecated() || !this.metadata().get(id)?.deprecated));
    const matches = (id: string) => `${id} ${this.metadata().get(id)?.description ?? ''}`.toLowerCase().includes(query);
    const order = plan?.groups.flat() ?? [];
    const keys = Object.keys(entries).sort((a, b) =>
      order.indexOf(eslintStepName(a)) - order.indexOf(eslintStepName(b)),
    );
    return [
      ...keys.map(key => {
        const original = entries[key]!;
        const config = isESLintFileConfig(original) ? original : orderedESLintBlocks(original);
        const rules = assignedRules(config).map(id => row(id, ruleSettings(config, id)));
        const name = eslintStepName(key);
        return {
          key, name, count: rules.length, settingsBlocks: settingsBlocks(config),
          configFile: isESLintFileConfig(config) ? config.configFile : null,
          status: plan?.removed?.includes(name) ? 'Removed from plan' : plan?.policies[name] ?? 'agent',
          rows: isESLintFileConfig(config) ? [] : config.flatMap((block, index) => {
            if (Object.hasOwn(block, 'settings')) return [{ id: typeof block['name'] === 'string' && block['name'].trim() ? `settings/${block['name']}` : 'settings', index, value: block, settings: true, override: 0 }];
            return Object.keys(block['rules'] as Record<string, unknown> ?? {}).filter(matches).map(id => ({
              id, index, value: (block['rules'] as Record<string, unknown>)[id], settings: false,
              override: config.slice(0, index).filter(previous => Object.hasOwn(previous['rules'] ?? {}, id)).length,
            }));
          }),
          rules: rules.filter(rule => matches(rule.id)),
        };
      }),
      {
        key: null as string | null, name: 'Unassigned', status: '', configFile: null,
        count: available.length, settingsBlocks: [], rows: available.filter(matches).map(id => ({ id, index: -1, value: undefined as unknown, settings: false, override: 0 })),
        rules: available.filter(matches).map(id => row(id, [])),
      },
    ];
  });

  readonly visibleBuckets = computed(() => this.buckets().filter(bucket =>
    bucket.name.toLowerCase().includes(this.nameSearch().trim().toLowerCase()),
  ));

  async addGroup(): Promise<void> {
    if (await this.change(plan => addESLintStep(plan, this.newName(),
      this.configuration() === 'file' ? this.configFile() : undefined))) {
      this.newName.set('');
      this.configFile.set('');
      this.addingGroup.set(false);
    }
  }

  drop(event: CdkDragDrop<string | null, string | null, string>): void {
    if (!event.isPointerOverContainer) return;
    const from = event.previousContainer.data;
    const to = event.container.data;
    const destination = this.buckets().find(bucket => bucket.key === to);
    const target = destination?.rows[event.currentIndex];
    const position = target?.index ?? (to === null ? 0 : orderedESLintBlocks(this.validation.state()!.plan.eslint![to]!).length);
    if (event.item.data.startsWith('block:') && from !== null) {
      const index = Number(event.item.data.slice(6));
      const row = this.buckets().find(bucket => bucket.key === from)?.rows.find(row => row.index === index);
      if (to === null && row && !row.settings) this.unassigned.update(ids => [...new Set([...ids, row.id])]);
      void this.change(plan => moveESLintBlock(plan, from, index, to, position));
    } else this.move(event.item.data, from, to);
  }

  move(id: string, from: string | null, to: string | null): void {
    if (to === null) this.unassigned.update(ids => [...new Set([...ids, id])]);
    void this.change(plan => moveESLintRule(plan, id, from, to));
  }

  readonly addingSettings = signal(false);
  readonly settingsTarget = signal('');
  readonly settingsName = signal('');

  addSettingsToFirstGroup(): void {
    const key = this.settingsTarget() || this.buckets().find(bucket => bucket.key !== null && !bucket.configFile)?.key;
    if (key) {
      this.addSettings(key);
      this.settingsName.set('');
      this.addingSettings.set(false);
    }
    else this.error.set('Add a managed group first.');
  }

  addSettings(key: string): void {
    void this.change(plan => editSettingsBlock(plan, key, null, { ...(this.settingsName().trim() ? { name: this.settingsName().trim() } : {}), settings: {} }));
  }

  saveSettings(value: string, key: string, index: number): void {
    void this.change(plan => editSettingsBlock(plan, key, index, JSON.parse(value)));
  }

  moveSettings(key: string, index: number, to: string | null, position?: number): void {
    void this.change(plan => moveSettingsBlock(plan, key, index, to, position));
  }

  updateSetting(value: string, key: string | null, id: string, index: number): void {
    if (key === null) return;
    void this.change(plan => setESLintRule(plan, key, id, index, JSON.parse(value)));
  }

  private async change(update: (plan: Plan) => Plan): Promise<boolean> {
    if (this.validation.editingDisabled()) return false;
    const plan = this.validation.state()?.plan;
    if (!plan) return false;
    this.error.set('');
    try {
      const normalized = { ...plan, eslint: Object.fromEntries(Object.entries(plan.eslint ?? {}).map(([key, config]) => [key, isESLintFileConfig(config) ? config : orderedESLintBlocks(config)])) };
      const next = update(normalized);
      if (next !== plan) await this.validation.configure(next);
      return !this.validation.actionError();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  summaryClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button, select, a')) event.preventDefault();
  }

  settingJson(value: unknown): string { return JSON.stringify(value, null, 2); }
  value(event: Event): string { return (event.target as HTMLInputElement).value; }
}
