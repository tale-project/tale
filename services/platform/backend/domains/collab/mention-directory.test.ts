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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return tag as unknown as Sql;
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
      if (text.startsWith('SELECT team_id AS "teamId"')) {
        return [{ teamId: null, sharedWithTeamIds: null }];
      }
      if (text.startsWith('SELECT allowed_agent_slugs')) {
        return [
          {
            allowedAgentSlugs: [],
            recommendedAgentSlugs: [],
            agentMode: 'all',
          },
        ];
      }
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
    // Org-wide surfaces are never permissive: an unclaimed token is a miss
    // reported back, not an agent.
    expect(resolved.unresolvedMentionTokens).toEqual(['ghost']);
  });
});
