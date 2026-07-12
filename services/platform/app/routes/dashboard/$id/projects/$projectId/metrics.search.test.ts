import { describe, expect, it } from 'vitest';

import { Route, searchSchema } from './metrics';

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
// JSON number 90, which must not crash the route via SearchParamError.
describe('project metrics searchSchema', () => {
  it('coerces numeric period values to the string enum', () => {
    expect(searchSchema.parse({ period: 90 }).period).toBe('90');
    expect(searchSchema.parse({ period: 30 }).period).toBe('30');
    expect(searchSchema.parse({ period: 7 }).period).toBe('7');
  });

  it('accepts string period values', () => {
    expect(searchSchema.parse({ period: '90' }).period).toBe('90');
  });

  it('falls back to the default window for out-of-range values', () => {
    expect(searchSchema.parse({ period: 999 }).period).toBe('30');
    expect(searchSchema.parse({ period: 'nonsense' }).period).toBe('30');
  });

  it('leaves an omitted period undefined', () => {
    expect(searchSchema.parse({}).period).toBeUndefined();
  });
});
