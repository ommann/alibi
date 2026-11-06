import { UrlSegment, type Routes, type UrlMatcher } from '@angular/router';

const projectMatcher: UrlMatcher = segments => {
  const view = segments.at(-1)?.path;
  const consumed = view === 'eslint' || view === 'presentation' ? segments.slice(0, -1) : segments;
  const cwd = '/' + consumed.map(segment => segment.path).join('/');

  return { consumed, posParams: { cwd: new UrlSegment(cwd, {}) } };
};

export const routes: Routes = [
  {
    matcher: projectMatcher,
    loadComponent: () => import('./project').then(m => m.Project),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./home/home').then(m => m.Home) },
      { path: 'eslint', loadComponent: () => import('./eslint/eslint').then(m => m.ESLint) },
      { path: 'presentation', loadComponent: () => import('./presentation/presentation').then(m => m.Presentation) },
    ],
  },
];
