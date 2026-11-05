import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CdkDragHandle } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-rule-row',
  imports: [CdkDragHandle],
  templateUrl: './rule-row.html',
  styleUrl: './rule-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleRow {
  readonly ruleId = input.required<string>();
  readonly group = input.required<string | null>();
  readonly targets = input.required<{ key: string | null; name: string; configFile: string | null }[]>();
  readonly disabled = input(false);
  readonly move = output<string | null>();

  selectMove(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (!select.value) return;
    this.move.emit(select.value === ':unassigned' ? null : select.value);
    select.value = '';
  }
}
