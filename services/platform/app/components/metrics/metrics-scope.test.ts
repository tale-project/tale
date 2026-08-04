import { describe, expect, it } from 'vitest';

import {
  soleScopeValue,
  type MetricsScopeOption,
} from '@/app/components/metrics/metrics-scope';

const ONE: MetricsScopeOption[] = [{ value: 'p1', label: 'Getting started' }];
const TWO: MetricsScopeOption[] = [
  { value: 'p1', label: 'Getting started' },
  { value: 'p2', label: 'Migration' },
];

// A scope-gated metrics page (Settings → Metrics → Projects) renders its empty
// state until a subject is chosen. With a single project that state is a dead
// end, so the page adopts it — but never guesses between several, and never
// while the list is loading.
describe('soleScopeValue', () => {
  it('adopts the only option when nothing is selected', () => {
    expect(soleScopeValue(ONE, undefined, false)).toBe('p1');
  });

  it('leaves the choice open when several options exist', () => {
    expect(soleScopeValue(TWO, undefined, false)).toBeUndefined();
  });

  it('never overrides an explicit selection', () => {
    expect(soleScopeValue(ONE, 'p1', false)).toBeUndefined();
    expect(soleScopeValue(TWO, 'p2', false)).toBeUndefined();
  });

  it('waits for the option list — a half-loaded list of one is not a scope', () => {
    expect(soleScopeValue(ONE, undefined, true)).toBeUndefined();
  });

  it('resolves nothing when there is nothing to scope to', () => {
    expect(soleScopeValue([], undefined, false)).toBeUndefined();
  });
});
