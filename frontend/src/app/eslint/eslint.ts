import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RuleRow } from './rule-row';
import { JsonEditor } from '../shared/json-editor';
import { ViewNavigation } from '../shared/view-navigation';
import { Checkbox } from '../shared/checkbox';
import { DragDropModule, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { ValidationState } from '../core/validation-state';
import { isESLintFileConfig, type Plan } from '../../../../shared/contracts';
import { addESLintStep, assignedRules, eslintStepName, moveESLintRule, ruleSettings, setESLintRule } from '../../../../shared/eslint-plan';

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
        const config = entries[key]!;
        const rules = assignedRules(config).map(id => row(id, ruleSettings(config, id)));
        const name = eslintStepName(key);
        return {
          key, name, count: rules.length,
          configFile: isESLintFileConfig(config) ? config.configFile : null,
          status: plan?.removed?.includes(name) ? 'Removed from plan' : plan?.policies[name] ?? 'agent',
          rules: rules.filter(rule => matches(rule.id)),
        };
      }),
      {
        key: null as string | null, name: 'Unassigned', status: '', configFile: null,
        count: available.length,
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
    if (event.isPointerOverContainer) this.move(event.item.data, event.previousContainer.data, event.container.data);
  }

  move(id: string, from: string | null, to: string | null): void {
    if (to === null) this.unassigned.update(ids => [...new Set([...ids, id])]);
    void this.change(plan => moveESLintRule(plan, id, from, to));
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
      const next = update(plan);
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
