import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ValidationState } from '../core/validation-state';

@Component({
  selector: 'app-view-navigation',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './view-navigation.html',
  styleUrl: './view-navigation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewNavigation {
  readonly validation = inject(ValidationState);
}
