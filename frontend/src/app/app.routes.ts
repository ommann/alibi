import { UrlSegment, type Routes, type UrlMatcher } from '@angular/router';

const projectMatcher: UrlMatcher = segments => {
  const boundary = segments.findIndex(segment => segment.path === '-');
  const consumed = boundary < 0 ? segments : segments.slice(0, boundary);
  const cwd = '/' + consumed.map(segment => segment.path).join('/');

  return { consumed, posParams: { cwd: new UrlSegment(cwd, {}) } };
};

export const routes: Routes = [
  {
    matcher: projectMatcher,
    loadComponent: () => import('./project').then(m => m.Project),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./home/home').then(m => m.Home) },
      { path: '-/presentation', loadComponent: () => import('./presentation/presentation').then(m => m.Presentation) },
    ],
  },
];
