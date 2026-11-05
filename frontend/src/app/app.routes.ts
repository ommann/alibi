import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./home/home').then(m => m.Home) },
  { path: 'presentation', loadComponent: () => import('./presentation/presentation').then(m => m.Presentation) },
  { path: '**', redirectTo: '' },
];
