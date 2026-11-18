import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Home } from './home/home';
import { ESLint } from './eslint/eslint';
import { Nibble } from './nibble/nibble';
import { Presentation } from './presentation/presentation';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ValidationState } from './core/validation-state';

@Component({
  selector: 'app-project',
  imports: [Home, ESLint, Nibble, Presentation],
  template: `
    @switch (fragment()) {
      @case ('eslint') { <app-eslint /> }
      @case ('nibble') { <app-nibble /> }
      @case ('presentation') { <app-presentation /> }
      @default { <app-home /> }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Project {
  readonly fragment = toSignal(inject(ActivatedRoute).fragment);

  constructor() {
    const state = inject(ValidationState);

    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      state.selectProject(params.get('cwd'));
    });
  }
}
