import { describe, expect, it } from 'vitest';

import { metricsPeriodSearchSchema } from '@/app/components/metrics/metrics-period';

import { Route } from './metrics';

// Regression coverage for the #2647 residual: this tab must NOT override the
// parent `$projectId` layout's `head`, which already sets the document title
// to the loaded project's own name. A generic `seo('projects')` override here
// (the *list* page's title) defeated that per-project title on this one tab —
// every sibling project tab (agents, threads, files, …) also leaves `head`
// unset for the same reason.
describe('project metrics route head', () => {
  it('does not override the parent layout route head', () => {
    expect(Route.options.head).toBeUndefined();
  });
});

// Regression coverage for #2033: a shared/bookmarked
// `/projects/$projectId/metrics?period=90` URL is parsed by the router as the
// JSON number 90, which must not crash the route via SearchParamError. The
// coercion behavior itself is covered by `metrics-period.test.ts`; this pins
// the route to that shared schema so it can't regress to a hand-rolled copy.
describe('project metrics search validation', () => {
  it('uses the shared coercing period schema', () => {
    expect(Route.options.validateSearch).toBe(metricsPeriodSearchSchema);
  });
});
