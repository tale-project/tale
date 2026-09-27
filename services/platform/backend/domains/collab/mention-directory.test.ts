import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { listAutomations } from '../automations/store.ts';
import {
  MentionDirectoryError,
  resolveSurfaceMentions,
} from './mention-directory.ts';

vi.mock('../automations/store.ts', () => ({ listAutomations: vi.fn() }));

type Row = Record<string, unknown>;

/** A postgres.js tagged-template stand-in answering (or failing) each
 * statement from its whitespace-collapsed text. */
function fakeDb(answer: (text: string) => Row[]): Sql {
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the postgres.js template function (+ `unsafe` for the column expressions)
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

const ADA = {
  userId: 'u-ada',
  role: 'member',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
};

describe('mention directory — a leg that cannot be listed fails loudly', () => {
  it('a failed member listing rejects instead of turning @teammate into text', async () => {
    // The old contract logged and returned a partial directory: the comment
    // posted, but the named teammate got no bell and nothing told the
    // author. The surface must fail (retryable) instead.
    const db = fakeDb((text) => {
      if (text.startsWith('SELECT m."userId"')) {
        throw new Error('connection reset');
      }
      return [];
    });
    await expect(
      resolveSurfaceMentions(db, {
        organizationId: 'org-1',
        body: '@ada please look',
      }),
    ).rejects.toMatchObject({
      name: 'MentionDirectoryError',
      code: 'MENTION_DIRECTORY_UNAVAILABLE',
      status: 503,
      leg: 'members',
    });
  });

  it('a failed automation listing rejects too — the owning-automation trigger rides it', async () => {
    vi.mocked(listAutomations).mockRejectedValueOnce(new Error('store down'));
    const db = fakeDb((text) => {
      if (text.startsWith('SELECT m."userId"')) return [ADA];
      if (text.includes('FROM app.projects')) return [{ teamIds: [] }];
      return [];
    });
    const failure: unknown = await resolveSurfaceMentions(db, {
      organizationId: 'org-1',
      body: '@ada ship it',
      projectId: 'proj-1',
    }).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MentionDirectoryError);
    expect(failure).toMatchObject({ leg: 'automations', status: 503 });
  });

  it('a healthy directory still resolves the teammate by every handle', async () => {
    const db = fakeDb((text) =>
      text.startsWith('SELECT m."userId"') ? [ADA] : [],
    );
    const resolved = await resolveSurfaceMentions(db, {
      organizationId: 'org-1',
      body: '@ada.lovelace please look, @ghost too',
    });
    expect(resolved.mentions).toEqual([
      expect.objectContaining({ type: 'user', id: 'u-ada' }),
    ]);
    // An unclaimed token is a miss reported back, not a guessed agent.
    expect(resolved.unresolvedMentionTokens).toEqual(['ghost']);
  });

  it('a serialization conflict in a leg reaches the retry loop unwrapped', async () => {
    // `transactSerializable` reruns on the SQLSTATE of the error it catches;
    // wrapped as MENTION_DIRECTORY_UNAVAILABLE the conflict became a 503
    // instead of a transparent rerun of the comment or task write.
    const conflict = Object.assign(
      new Error('could not serialize access due to read/write dependencies'),
      { code: '40001' },
    );
    const db = fakeDb((text) => {
      if (text.startsWith('SELECT m."userId"')) throw conflict;
      return [];
    });
    await expect(
      resolveSurfaceMentions(db, { organizationId: 'org-1', body: '@ada' }),
    ).rejects.toBe(conflict);
  });
});

describe('mention directory — an edit names only who it adds', () => {
  const BOB = {
    userId: 'u-bob',
    role: 'member',
    email: 'bob@example.com',
    displayName: 'Bob Stone',
  };
  const members = fakeDb((text) =>
    text.startsWith('SELECT m."userId"') ? [ADA, BOB] : [],
  );

  it('without a previous text every mention is new', async () => {
    const resolved = await resolveSurfaceMentions(members, {
      organizationId: 'org-1',
      body: '@ada and @bob please look',
    });
    expect(resolved.added).toEqual(resolved.mentions);
    expect(resolved.added.map((mention) => mention.id)).toEqual([
      'u-ada',
      'u-bob',
    ]);
  });

  it('diffs against the replaced text, whichever handle names the person', async () => {
    const resolved = await resolveSurfaceMentions(members, {
      organizationId: 'org-1',
      previousBody: '@ada please look',
      // Ada is still named, through another of her handles; Bob is new.
      body: '@ada.lovelace please look, cc @bob',
    });
    expect(resolved.mentions.map((mention) => mention.id)).toEqual([
      'u-ada',
      'u-bob',
    ]);
    expect(resolved.added).toEqual([{ type: 'user', id: 'u-bob' }]);
  });

  it('a reworded text that names the same people adds nobody', async () => {
    const resolved = await resolveSurfaceMentions(members, {
      organizationId: 'org-1',
      previousBody: '@ada and @bob please look',
      body: 'Please look by Friday, @bob and @ada',
    });
    expect(resolved.mentions).toHaveLength(2);
    expect(resolved.added).toEqual([]);
  });
});
