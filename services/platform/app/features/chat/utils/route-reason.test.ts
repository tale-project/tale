import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { type RouteReason, routeReasonLabel } from './route-reason';

// Key-echoing translator stub: returns the catalogue key so we can assert which
// key each reason resolves to. Cast to TFunction — routeReasonLabel only ever
// calls it as t(key).
const t = ((key: string) => key) as unknown as TFunction;

describe('routeReasonLabel', () => {
  it('maps every route reason to its chat-namespace catalogue key', () => {
    const cases: Array<[RouteReason, string]> = [
      ['single-candidate', 'routing.reason.single-candidate'],
      ['trivial', 'routing.reason.trivial'],
      ['cached', 'routing.reason.cached'],
      ['classified', 'routing.reason.classified'],
      ['fallback', 'routing.reason.fallback'],
    ];
    for (const [reason, key] of cases) {
      expect(routeReasonLabel(t, reason)).toBe(key);
    }
  });
});
