import { describe, expect, it } from 'vitest';

import type { Doc } from '../../_generated/dataModel';
import {
  isActiveRow,
  queryTokens,
  rowMatches,
  scoreAndSort,
} from './relevance';
import { contactsSearchStrategy } from './strategies/contacts';
import { projectsSearchStrategy } from './strategies/projects';
import { tasksSearchStrategy } from './strategies/tasks';

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

// ---------------------------------------------------------------- 'any' mode

/** A minimal task doc. Same widening trick as `contact` — only the searched
 *  fields matter to the pure helpers. */
function task(
  overrides: Partial<Omit<Doc<'tasks'>, '_id'>> & { _id?: string },
): Doc<'tasks'> {
  return {
    _id: 't1',
    _creationTime: 0,
    organizationId: 'org',
    projectId: 'p1',
    title: '',
    ...overrides,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture; only the searched fields matter
  } as Doc<'tasks'>;
}

const anyMatch = (row: Doc<'tasks'>, term: string) =>
  rowMatches(row, tasksSearchStrategy, term.toLowerCase(), term, 'any');
const allMatch = (row: Doc<'tasks'>, term: string) =>
  rowMatches(row, tasksSearchStrategy, term.toLowerCase(), term, 'all');

describe('queryTokens', () => {
  it("leaves the query verbatim in 'all' mode", () => {
    expect(queryTokens('what open tasks', 'all')).toEqual([
      'what',
      'open',
      'tasks',
    ]);
  });

  it("drops function words and one-character fragments in 'any' mode", () => {
    expect(queryTokens('what open tasks do we have', 'any')).toEqual([
      'open',
      'tasks',
    ]);
    expect(queryTokens('a b facebook', 'any')).toEqual(['facebook']);
  });

  it('drops German and French function words, not just English', () => {
    expect(queryTokens('welche aufgaben haben wir', 'any')).toEqual([
      'aufgaben',
    ]);
    expect(queryTokens('quelles sont les tâches ouvertes', 'any')).toEqual([
      'quelles',
      'tâches',
      'ouvertes',
    ]);
  });

  it('keeps board vocabulary that doubles as a common word', () => {
    // "open", "done" and "review" are statuses — dropping them as stopwords
    // would make the most common question about a board unanswerable.
    expect(queryTokens('open done review', 'any')).toEqual([
      'open',
      'done',
      'review',
    ]);
  });

  it("returns nothing for an all-stopword query in 'any' mode", () => {
    expect(queryTokens('what do we have', 'any')).toEqual([]);
  });
});

describe("rowMatches in 'any' mode", () => {
  it('finds the task the reported failure could not', () => {
    // The question a user actually asked, verbatim from the bug report. Under
    // AND semantics "recruitment" alone sinks it, which is exactly why chat
    // answered "no open project tasks" and recommended a competitor.
    const question = 'recruitment ads Facebook ad account project tasks';
    const row = task({ title: 'Set up Facebook ad account' });

    expect(allMatch(row, question)).toBe(false);
    expect(anyMatch(row, question)).toBe(true);
  });

  it('matches on the description as well as the title', () => {
    const row = task({
      title: 'Q3 launch',
      description: 'Book the venue in Rotterdam',
    });
    expect(anyMatch(row, 'where are we with the venue booking')).toBe(true);
  });

  it('matches nothing when the query is only function words', () => {
    // The row's title deliberately CONTAINS the query's words: without the
    // stopword filter it matches, and so would every other row in the org.
    // Honest emptiness beats returning the whole board.
    expect(
      anyMatch(task({ title: 'What we have on the shelf' }), 'what do we have'),
    ).toBe(false);
  });

  it('refuses a bare mid-word substring as the only evidence', () => {
    // "ad" inside "overhead" is noise once tokens are OR-ed. As a whole word
    // it is a real hit.
    expect(anyMatch(task({ title: 'Reduce overhead' }), 'ad spend')).toBe(
      false,
    );
    expect(anyMatch(task({ title: 'Facebook ad spend' }), 'ad spend')).toBe(
      true,
    );
  });

  it('still requires every token under the default mode', () => {
    const row = task({ title: 'Set up Facebook ad account' });
    // No explicit mode → 'all', so existing callers are untouched.
    expect(
      rowMatches(row, tasksSearchStrategy, 'facebook paris', 'facebook paris'),
    ).toBe(false);
  });

  it('ignores fields not configured on the tasks strategy', () => {
    // `status` and `rank` are real columns but not searchable text — a query
    // for "todo" must not match every task in the todo column.
    expect(anyMatch(task({ title: 'x', status: 'todo' }), 'todo')).toBe(false);
    expect(anyMatch(task({ title: 'x', rank: 'aaz' }), 'aaz')).toBe(false);
  });

  it('matches a task by its external tracker id', () => {
    expect(anyMatch(task({ title: 'x', externalId: 'GH-914' }), 'GH-914')).toBe(
      true,
    );
  });
});

describe("scoreAndSort in 'any' mode", () => {
  it('puts the row that answers the most of the question first', () => {
    const question = 'recruitment ads Facebook ad account project tasks';
    const rows = [
      // Hits one token, and is the newer row — recency must not win here.
      task({ _id: 'weak', title: 'Facebook page refresh', _creationTime: 9 }),
      // Hits three: facebook, ad, account.
      task({
        _id: 'strong',
        title: 'Set up Facebook ad account',
        _creationTime: 1,
      }),
    ];
    const ordered = scoreAndSort(
      rows,
      tasksSearchStrategy,
      question.toLowerCase(),
      'any',
    );
    expect(ordered.map((r) => r._id)).toEqual(['strong', 'weak']);
  });

  it('scores over the same tokens it matched on', () => {
    // Ranking must read the FILTERED tokens, not the raw query. The noise row
    // is stuffed with function words so that, if stopwords still scored, its
    // six weak hits would outrank the one row that actually answers.
    const rows = [
      task({
        _id: 'noise',
        title: 'What do we have about the shelf',
        _creationTime: 9,
      }),
      task({ _id: 'real', title: 'Account', _creationTime: 1 }),
    ];
    const ordered = scoreAndSort(
      rows,
      tasksSearchStrategy,
      'what do we have about the account',
      'any',
    );
    expect(ordered.map((r) => r._id)).toEqual(['real', 'noise']);
  });
});

describe('projectsSearchStrategy', () => {
  function project(
    overrides: Partial<Omit<Doc<'projects'>, '_id'>> & { _id?: string },
  ): Doc<'projects'> {
    return {
      _id: 'p1',
      _creationTime: 0,
      organizationId: 'org',
      name: '',
      ...overrides,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture; only the searched fields matter
    } as Doc<'projects'>;
  }

  it('matches a project by name and by its short key', () => {
    const row = project({ name: 'Recruitment', key: 'REC' });
    expect(
      rowMatches(row, projectsSearchStrategy, 'recruitment', 'recruitment'),
    ).toBe(true);
    expect(rowMatches(row, projectsSearchStrategy, 'rec', 'REC')).toBe(true);
  });

  it('does not match on colour or icon', () => {
    const row = project({ name: 'Recruitment', color: 'teal', icon: 'flag' });
    expect(rowMatches(row, projectsSearchStrategy, 'teal', 'teal')).toBe(false);
    expect(rowMatches(row, projectsSearchStrategy, 'flag', 'flag')).toBe(false);
  });
});
