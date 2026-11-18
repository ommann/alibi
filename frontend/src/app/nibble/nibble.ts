import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ViewNavigation } from '../shared/view-navigation';
import { Checkbox } from '../shared/checkbox';

@Component({
  selector: 'app-nibble',
  imports: [ViewNavigation, Checkbox],
  templateUrl: './nibble.html',
  styleUrl: './nibble.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nibble {
  readonly budget = signal<number | null>(null);
  readonly dirtyFilesFirst = signal(true);
  readonly wholeFilesFirst = signal(true);

  setBudget(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value === '') {
      this.budget.set(null);
    } else if (input.validity.valid && Number.isSafeInteger(input.valueAsNumber)) {
      this.budget.set(input.valueAsNumber);
    }
  }
}
