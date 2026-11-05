import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ValidationState } from '../core/validation-state';
import { AnsiOutput } from '../shared/ansi-output';

@Component({
  selector: 'app-presentation',
  imports: [RouterLink, AnsiOutput],
  templateUrl: './presentation.html',
  styleUrl: './presentation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Presentation {
  readonly validation = inject(ValidationState);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly following = signal(true);

  constructor() {
    afterRenderEffect(() => {
      this.validation.latestRun();
      const element = this.viewport()?.nativeElement;
      if (element && this.following()) element.scrollTop = element.scrollHeight;
    });
  }

  scroll(event: Event): void {
    const element = event.target as HTMLElement;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    this.following.set(element.scrollHeight - element.scrollTop - element.clientHeight < lineHeight * 2);
  }
}
