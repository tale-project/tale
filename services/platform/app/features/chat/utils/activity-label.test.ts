import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { ragSearchListingKind, stepActivityLabel } from './activity-label';

/** A translator that renders the key and its params, so an assertion reads
 * the exact call instead of a locale string. */
function fakeT(): TFunction {
  const impl = (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key} ${JSON.stringify(params)}`;
  return impl as TFunction;
}

describe('stepActivityLabel — rag_search', () => {
  const t = fakeT();

  it('labels a list call by its kind, never with empty quotes', () => {
    const label = stepActivityLabel(t, {
      tool: 'rag_search',
      input: { action: 'list', kind: 'task', status: 'in_review' },
    });
    expect(label).toBe('thinking.listing.tasks');
    expect(label).not.toContain('""');
  });

  it('reads a queryless kind-only call as the list the executor runs', () => {
    expect(
      stepActivityLabel(t, {
        tool: 'rag_search',
        input: { kind: 'contact' },
      }),
    ).toBe('thinking.listing.contacts');
  });

  it('falls back to the generic listing label on an unknown kind', () => {
    expect(
      stepActivityLabel(t, {
        tool: 'rag_search',
        input: { action: 'list', kind: 'mystery' },
      }),
    ).toBe('thinking.listing.generic');
    expect(
      stepActivityLabel(t, {
        tool: 'rag_search',
        input: { action: 'list' },
      }),
    ).toBe('thinking.listing.generic');
  });

  it('keeps every historical query row rendering as a search', () => {
    expect(
      stepActivityLabel(t, {
        tool: 'rag_search',
        detail: 'refunds',
        input: { query: 'refunds' },
      }),
    ).toBe('thinking.searchingKnowledgeBase {"query":"refunds"}');
    // A row with no input at all (the oldest shape) still renders.
    expect(
      stepActivityLabel(t, { tool: 'rag_search', detail: 'refunds' }),
    ).toBe('thinking.searchingKnowledgeBase {"query":"refunds"}');
  });

  it('a kind-narrowed search stays a search label', () => {
    expect(
      stepActivityLabel(t, {
        tool: 'rag_search',
        detail: 'ada',
        input: { action: 'search', query: 'ada', kind: 'contact' },
      }),
    ).toBe('thinking.searchingKnowledgeBase {"query":"ada"}');
  });
});

describe('ragSearchListingKind', () => {
  it('never reads a query-bearing call as a list', () => {
    expect(ragSearchListingKind({ query: 'open tasks' })).toBeUndefined();
    expect(
      ragSearchListingKind({ action: 'search', query: 'x', kind: 'task' }),
    ).toBeUndefined();
    expect(ragSearchListingKind(undefined)).toBeUndefined();
    expect(ragSearchListingKind('list')).toBeUndefined();
  });
});
