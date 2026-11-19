import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ViewNavigation } from '../shared/view-navigation';
import { Checkbox } from '../shared/checkbox';
import { ValidationState } from '../core/validation-state';
import { defaultNibble, type NibbleConfig } from '../../../../shared/nibble';
import { assignedRules } from '../../../../shared/eslint-plan';
import { DragDropModule, type CdkDragDrop } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-nibble',
  imports: [ViewNavigation, Checkbox, DragDropModule],
  templateUrl: './nibble.html',
  styleUrl: './nibble.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nibble {
  readonly validation = inject(ValidationState);
  readonly search = signal('');
  readonly config = computed(() => this.validation.state()?.plan.nibble ?? defaultNibble);
  readonly selectedRules = computed(() => this.config().rules);
  readonly counts = computed(() => this.validation.state()?.nibbleCounts ?? {});
  readonly groupRules = computed(() => {
    const metadata = new Map(this.validation.eslintRules().map(rule => [rule.id, rule]));
    const ids = [...new Set(Object.values(this.validation.state()?.plan.eslint ?? {}).flatMap(assignedRules))];
    return ids.sort().map(id => metadata.get(id) ?? { id, description: '' });
  });

  async save(patch: Partial<NibbleConfig>): Promise<void> {
    const plan = this.validation.state()?.plan;
    if (!plan || this.validation.editingDisabled()) return;
    await this.validation.configure({ ...plan, nibble: { ...this.config(), ...patch } });
  }
  readonly availableRules = computed(() => {
    const selected = new Set(this.selectedRules());
    const query = this.search().trim().toLowerCase();
    return this.groupRules().filter(rule => !selected.has(rule.id) &&
      `${rule.id} ${rule.description ?? ''}`.toLowerCase().includes(query));
  });

  addRule(id: string): void {
    if (this.groupRules().some(rule => rule.id === id) && !this.selectedRules().includes(id)) {
      void this.save({ rules: [...this.selectedRules(), id] });
    }
  }

  removeRule(id: string): void {
    void this.save({ rules: this.selectedRules().filter(value => value !== id) });
  }
  readonly orderedRules = computed(() => {
    const metadata = new Map(this.validation.eslintRules().map(rule => [rule.id, rule]));
    return this.selectedRules().map(id => metadata.get(id) ?? { id, description: '' });
  });
  readonly rules = this.orderedRules;

  constructor() {
    void this.validation.loadESLintRules();
  }

  drop(event: CdkDragDrop<unknown>): void {
    if (!event.isPointerOverContainer || event.previousIndex === event.currentIndex) return;
    const visible = this.rules();
    const moved = visible[event.previousIndex];
    const target = visible[event.currentIndex];
    if (!moved || !target) return;
    const ids = this.orderedRules().map(rule => rule.id).filter(id => id !== moved.id);
    const targetIndex = ids.indexOf(target.id);
    ids.splice(targetIndex + (event.currentIndex > event.previousIndex ? 1 : 0), 0, moved.id);
    void this.save({ rules: ids });
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  readonly budget = computed(() => this.config().budget);
  readonly dirtyFilesFirst = computed(() => this.config().dirtyFilesFirst);
  readonly wholeFilesFirst = computed(() => this.config().wholeFilesFirst);
  readonly randomSelection = computed(() => this.config().randomSelection);

  setBudget(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value !== '' && (!input.validity.valid || !Number.isSafeInteger(input.valueAsNumber))) return;
    const value = input.value === '' ? null : input.valueAsNumber;
    void this.save({ budget: value });
  }
}
