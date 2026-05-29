import { describe, expect, it } from 'vitest';

import type { Doc } from '../../_generated/dataModel';
import { isActiveRow, rowMatches, scoreAndSort } from './relevance';
import { customersSearchStrategy } from './strategies/customers';

/** Build a minimal customer doc for the pure matching/scoring helpers. `_id`
 *  is widened to `string` so a test can label rows ('exact'/'prefix'/…) without
 *  minting a branded `Id<'customers'>`; only the searched fields matter here. */
function customer(
  overrides: Partial<Omit<Doc<'customers'>, '_id'>> & { _id?: string },
): Doc<'customers'> {
  return {
    _id: 'c1',
    _creationTime: 0,
    organizationId: 'org',
    name: '',
    ...overrides,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture; only the searched fields matter
  } as Doc<'customers'>;
}

const match = (row: Doc<'customers'>, term: string) =>
  rowMatches(row, customersSearchStrategy, term.toLowerCase(), term);

describe('rowMatches', () => {
  it('matches a name substring case-insensitively', () => {
    expect(match(customer({ name: 'Acme Corp' }), 'acme')).toBe(true);
    expect(match(customer({ name: 'Acme Corp' }), 'CORP')).toBe(true);
    expect(match(customer({ name: 'Acme Corp' }), 'zzz')).toBe(false);
  });

  it('matches an email substring', () => {
    expect(match(customer({ name: 'x', email: 'jo@tale.dev' }), 'tale')).toBe(
      true,
    );
  });

  it('matches externalId exactly and as a substring', () => {
    expect(
      match(customer({ name: 'x', externalId: 'CUST-42' }), 'CUST-42'),
    ).toBe(true);
    expect(match(customer({ name: 'x', externalId: 'CUST-42' }), '42')).toBe(
      true,
    );
  });

  it('ignores fields not configured on the strategy', () => {
    // `source` is not a search field — its value must not match.
    expect(match(customer({ name: 'x', source: 'shopify' }), 'shopify')).toBe(
      false,
    );
  });

  it('matches a numeric externalId', () => {
    expect(match(customer({ name: 'x', externalId: 4242 }), '4242')).toBe(true);
    expect(match(customer({ name: 'x', externalId: 4242 }), '99')).toBe(false);
  });

  it('matches everything for an empty term', () => {
    expect(match(customer({ name: 'anything' }), '')).toBe(true);
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
      customer({ _id: 'sub', name: 'my config tool', _creationTime: 5 }),
      customer({ _id: 'exact', name: 'config', _creationTime: 1 }),
      customer({ _id: 'prefix', name: 'configuration', _creationTime: 2 }),
    ];
    const ordered = scoreAndSort(rows, customersSearchStrategy, 'config');
    expect(ordered.map((r) => r._id)).toEqual(['exact', 'prefix', 'sub']);
  });

  it('breaks ties by creation time (newest first)', () => {
    const rows = [
      customer({ _id: 'old', name: 'config', _creationTime: 1 }),
      customer({ _id: 'new', name: 'config', _creationTime: 9 }),
    ];
    const ordered = scoreAndSort(rows, customersSearchStrategy, 'config');
    expect(ordered.map((r) => r._id)).toEqual(['new', 'old']);
  });
});
