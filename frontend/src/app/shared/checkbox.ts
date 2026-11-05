import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

@Component({
  selector: 'app-checkbox',
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkbox {
  readonly checked = model(false);
  readonly indeterminate = input(false);
  readonly disabled = input(false);
  readonly ariaLabel = input<string>();

  change(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
