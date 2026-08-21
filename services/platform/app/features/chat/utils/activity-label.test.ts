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

describe('a mail-attachment list has its own label', () => {
  // Without a key of its own the kind falls back to the generic
  // "Listing the workspace", which is true but tells the reader nothing about
  // what the turn actually looked at.
  it('labels the step from the mail-attachment key', () => {
    // No casts: the field is `tool`, and letting the types check the step
    // shape is what catches a mistyped field instead of silently falling
    // through to another branch.
    const label = stepActivityLabel(fakeT(), {
      tool: 'rag_search',
      input: { action: 'list', kind: 'mail-attachment' },
    });
    expect(label).toBe('thinking.listing.mailAttachments');
    expect(label).not.toContain('""');
  });

  it('resolves the listing kind from the call', () => {
    expect(
      ragSearchListingKind({ action: 'list', kind: 'mail-attachment' }),
    ).toBe('mail-attachment');
  });
});
