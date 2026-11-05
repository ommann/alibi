import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ValidationState } from './core/validation-state';

@Component({
  selector: 'app-project',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Project {
  constructor() {
    const state = inject(ValidationState);

    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      state.selectProject(params.get('cwd'));
    });
  }
}
