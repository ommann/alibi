import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { ViewNavigation } from '../shared/view-navigation';
import { DragDropModule, moveItemInArray, transferArrayItem, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { ValidationState } from '../core/validation-state';
import { AnsiOutput } from '../shared/ansi-output';
import type { Plan, Policy, Run } from '../../../../shared/contracts';

@Component({
  selector: 'app-home',
  imports: [ViewNavigation, DatePipe, KeyValuePipe, AnsiOutput, DragDropModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  readonly validation = inject(ValidationState);
  readonly policies: Policy[] = ['agent', 'user', 'off'];
  readonly groups = computed(() => [...(this.validation.state()?.plan.groups ?? []), []], {
    equal: (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
  });
  private readonly clock = signal(Date.now());

  readonly selectedId = signal<string | null>(null);
  readonly runs = computed(() => [...(this.validation.state()?.runs ?? [])].reverse());
  readonly selectedRun = computed<Run | null>(() =>
    this.runs().find(run => run.id === this.selectedId()) ?? this.runs()[0] ?? null,
  );
  readonly visibleResults = computed(() =>
    this.selectedRun()?.results.filter(result => result.policy !== 'off') ?? [],
  );
  readonly disabled = computed(() => {
    const state = this.validation.state();
    return state?.steps.filter(step => !state.plan.groups.flat().includes(step.name)) ?? [];
  });

  constructor() {
    const timer = setInterval(() => this.clock.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  passed(run: Run): number {
    return run.results.filter(result => result.status === 'passed').length;
  }

  total(run: Run): number {
    return run.results.filter(result => result.status !== 'skipped').length;
  }

  duration(start?: string, finish?: string): string {
    if (!start) return '—';
    const milliseconds = Math.max(0, (finish ? Date.parse(finish) : this.clock()) - Date.parse(start));
    return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
  }

  summaryClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button')) event.preventDefault();
  }

  policy(name: string, policy: Policy): void {
    this.update(plan => ({ ...plan, policies: { ...plan.policies, [name]: policy } }));
  }

  enable(name: string): void {
    this.update(plan => ({
      ...plan,
      groups: [...plan.groups, [name]],
      removed: plan.removed?.filter(item => item !== name),
      policies: { ...plan.policies, [name]: 'agent' },
    }));
  }

  parameter(name: string, key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;

    this.update(plan => ({
      ...plan,
      configs: { ...plan.configs, [name]: { ...plan.configs?.[name], [key]: value } },
    }));
  }

  dropAnalysis(event: CdkDragDrop<string[]>): void {
    const groups = this.groups().map(group => [...group]);
    const source = this.groups().indexOf(event.previousContainer.data);
    const target = this.groups().indexOf(event.container.data);
    if (source < 0 || target < 0) return;

    if (source === target) {
      moveItemInArray(groups[target]!, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(groups[source]!, groups[target]!, event.previousIndex, event.currentIndex);
    }

    this.update(plan => ({ ...plan, groups: groups.filter(group => group.length) }));
  }

  dropGroup(event: CdkDragDrop<string[][]>): void {
    const groups = this.groups().slice(0, -1).map(group => [...group]);
    moveItemInArray(groups, event.previousIndex, Math.min(event.currentIndex, groups.length - 1));
    this.update(plan => ({ ...plan, groups }));
  }

  remove(name: string): void {
    this.update(plan => ({
      ...plan,
      groups: plan.groups.map(group => group.filter(item => item !== name)).filter(group => group.length),
      removed: [...(plan.removed ?? []), name],
    }));
  }

  private update(change: (plan: Plan) => Plan): void {
    const plan = this.validation.state()?.plan;
    if (plan) void this.validation.configure(change(plan));
  }
}
