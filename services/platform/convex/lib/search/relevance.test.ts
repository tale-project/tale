import { describe, expect, it } from 'vitest';

import type { Doc } from '../../_generated/dataModel';
import { isActiveRow, rowMatches, scoreAndSort } from './relevance';
import { contactsSearchStrategy } from './strategies/contacts';

/** Build a minimal contact doc for the pure matching/scoring helpers. `_id`
 *  is widened to `string` so a test can label rows ('exact'/'prefix'/…) without
 *  minting a branded `Id<'contacts'>`; only the searched fields matter here. */
function contact(
  overrides: Partial<Omit<Doc<'contacts'>, '_id'>> & { _id?: string },
): Doc<'contacts'> {
  return {
    _id: 'c1',
    _creationTime: 0,
    organizationId: 'org',
    name: '',
    ...overrides,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture; only the searched fields matter
  } as Doc<'contacts'>;
}

const match = (row: Doc<'contacts'>, term: string) =>
  rowMatches(row, contactsSearchStrategy, term.toLowerCase(), term);

describe('rowMatches', () => {
  it('matches a name substring case-insensitively', () => {
    expect(match(contact({ name: 'Acme Corp' }), 'acme')).toBe(true);
    expect(match(contact({ name: 'Acme Corp' }), 'CORP')).toBe(true);
    expect(match(contact({ name: 'Acme Corp' }), 'zzz')).toBe(false);
  });

  it('matches an email substring', () => {
    expect(match(contact({ name: 'x', email: 'jo@tale.dev' }), 'tale')).toBe(
      true,
    );
  });

  it('matches externalId exactly and as a substring', () => {
    expect(
      match(contact({ name: 'x', externalId: 'CUST-42' }), 'CUST-42'),
    ).toBe(true);
    expect(match(contact({ name: 'x', externalId: 'CUST-42' }), '42')).toBe(
      true,
    );
  });

  it('ignores fields not configured on the strategy', () => {
    // `source` is not a search field — its value must not match.
    expect(match(contact({ name: 'x', source: 'shopify' }), 'shopify')).toBe(
      false,
    );
  });

  it('matches a numeric externalId', () => {
    expect(match(contact({ name: 'x', externalId: 4242 }), '4242')).toBe(true);
    expect(match(contact({ name: 'x', externalId: 4242 }), '99')).toBe(false);
  });

  it('requires every token to match across fields (multi-token AND)', () => {
    const row = contact({ name: 'John Doe', email: 'john@acme.io' });
    // 'john' hits the name, 'acme' hits the email — both present → match.
    expect(match(row, 'john acme')).toBe(true);
    // 'paris' hits no configured field → the whole query fails.
    expect(match(row, 'john paris')).toBe(false);
  });

  it('matches everything for an empty term', () => {
    expect(match(contact({ name: 'anything' }), '')).toBe(true);
  });
});

describe('isActiveRow', () => {
  it('treats a missing lifecycleStatus as active', () => {
    expect(isActiveRow({})).toBe(true);
  });
  it('treats explicit active as active and anything else as inactive', () => {
    expect(isActiveRow({ lifecycleStatus: 'active' })).toBe(true);
    expect(isActiveRow({ lifecycleStatus: 'trashed' })).toBe(false);
  });
});

describe('scoreAndSort', () => {
  it('ranks exact > prefix > substring, then newest first', () => {
    const rows = [
      contact({ _id: 'sub', name: 'my config tool', _creationTime: 5 }),
      contact({ _id: 'exact', name: 'config', _creationTime: 1 }),
      contact({ _id: 'prefix', name: 'configuration', _creationTime: 2 }),
    ];
    const ordered = scoreAndSort(rows, contactsSearchStrategy, 'config');
    expect(ordered.map((r) => r._id)).toEqual(['exact', 'prefix', 'sub']);
  });

  it('breaks ties by creation time (newest first)', () => {
    const rows = [
      contact({ _id: 'old', name: 'config', _creationTime: 1 }),
      contact({ _id: 'new', name: 'config', _creationTime: 9 }),
    ];
    const ordered = scoreAndSort(rows, contactsSearchStrategy, 'config');
    expect(ordered.map((r) => r._id)).toEqual(['new', 'old']);
  });

  it('ranks a word-prefix match above a mid-word substring', () => {
    const rows = [
      contact({ _id: 'mid', name: 'Brianna Smith', _creationTime: 9 }),
      contact({ _id: 'word', name: 'Anna Lee', _creationTime: 1 }),
    ];
    // "anna" starts a word; "brianna" only contains "ann" mid-word — relevance
    // wins over recency even though the mid-word row is newer.
    const ordered = scoreAndSort(rows, contactsSearchStrategy, 'ann');
    expect(ordered.map((r) => r._id)).toEqual(['word', 'mid']);
  });

  it('ranks a name hit above an equal-strength email hit', () => {
    const rows = [
      contact({
        _id: 'email',
        name: 'Zeta',
        email: 'z.acme@x.io',
        _creationTime: 9,
      }),
      contact({
        _id: 'name',
        name: 'My Acme',
        email: 'z@x.io',
        _creationTime: 1,
      }),
    ];
    // Both match "acme" as a word-prefix; the higher-priority `name` field wins.
    const ordered = scoreAndSort(rows, contactsSearchStrategy, 'acme');
    expect(ordered.map((r) => r._id)).toEqual(['name', 'email']);
  });

  it('ranks an exact id match above a strong name match', () => {
    const rows = [
      contact({ _id: 'name', name: 'CUST-7 Industries', _creationTime: 9 }),
      contact({
        _id: 'id',
        name: 'Other',
        externalId: 'CUST-7',
        _creationTime: 1,
      }),
    ];
    const ordered = scoreAndSort(rows, contactsSearchStrategy, 'cust-7');
    expect(ordered.map((r) => r._id)).toEqual(['id', 'name']);
  });
});
