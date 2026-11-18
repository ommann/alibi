import { UrlSegment, type Routes, type UrlMatcher } from '@angular/router';

const projectMatcher: UrlMatcher = segments => {
  const cwd = '/' + segments.map(segment => segment.path).join('/');
  return { consumed: segments, posParams: { cwd: new UrlSegment(cwd, {}) } };
};

export const routes: Routes = [
  {
    matcher: projectMatcher,
    title: route => {
      const name = route.paramMap.get('cwd')?.split('/').filter(Boolean).at(-1);
      return name ? `${name} — Alibi` : 'Alibi';
    },
    loadComponent: () => import('./project').then(m => m.Project),
  },
];
