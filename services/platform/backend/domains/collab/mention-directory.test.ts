import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { listAutomations } from '../automations/store.ts';
import {
  currentMentionNames,
  MentionDirectoryError,
  prepareSurfaceText,
} from './mention-directory.ts';

vi.mock('../automations/store.ts', () => ({ listAutomations: vi.fn() }));

type Row = Record<string, unknown>;

/** A postgres.js tagged-template stand-in answering (or failing) each
 * statement from its whitespace-collapsed text. */
function fakeDb(
  answer: (text: string) => Row[],
  statements: string[] = [],
): Sql {
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
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

describe('mention directory — a leg that cannot be listed fails loudly [COLLAB-R5]', () => {
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
      prepareSurfaceText(db, {
        organizationId: 'org-1',
        body: '@ada please look',
        cap: 10_000,
        mode: 'full',
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
    const failure: unknown = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      body: '@ada ship it',
      projectId: 'proj-1',
      cap: 10_000,
      mode: 'full',
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
    const resolved = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      body: '@ada.lovelace please look, @ghost too',
      cap: 10_000,
      mode: 'full',
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
      prepareSurfaceText(db, {
        organizationId: 'org-1',
        body: '@ada',
        cap: 10_000,
        mode: 'full',
      }),
    ).rejects.toBe(conflict);
  });
});

describe('mention directory — an edit names only who it adds [COLLAB-R4]', () => {
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
    const resolved = await prepareSurfaceText(members, {
      organizationId: 'org-1',
      body: '@ada and @bob please look',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.added).toEqual(resolved.mentions);
    expect(resolved.added.map((mention) => mention.id)).toEqual([
      'u-ada',
      'u-bob',
    ]);
  });

  it('diffs against the replaced text, whichever handle names the person', async () => {
    const resolved = await prepareSurfaceText(members, {
      organizationId: 'org-1',
      previousBody: '@ada please look',
      // Ada is still named, through another of her handles; Bob is new.
      body: '@ada.lovelace please look, cc @bob',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.mentions.map((mention) => mention.id)).toEqual([
      'u-ada',
      'u-bob',
    ]);
    expect(resolved.added).toEqual([{ type: 'user', id: 'u-bob' }]);
  });

  it('a reworded text that names the same people adds nobody', async () => {
    const resolved = await prepareSurfaceText(members, {
      organizationId: 'org-1',
      previousBody: '@ada and @bob please look',
      body: 'Please look by Friday, @bob and @ada',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.mentions).toHaveLength(2);
    expect(resolved.added).toEqual([]);
  });
});

const ADA_TOKEN = '[@Ada Lovelace](mention:user/u-ada)';

describe('a mention is saved as whom it names [COLLAB-R10]', () => {
  const members = (statements: string[] = []) =>
    fakeDb(
      (text) => (text.startsWith('SELECT m."userId"') ? [ADA] : []),
      statements,
    );

  it('stores a resolved handle as a token, and leaves a text without mentions alone', async () => {
    const resolved = await prepareSurfaceText(members(), {
      organizationId: 'org-1',
      body: '@ada.lovelace please look, @ghost too',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.text).toBe(`${ADA_TOKEN} please look, @ghost too`);

    const statements: string[] = [];
    const quiet = await prepareSurfaceText(members(statements), {
      organizationId: 'org-1',
      body: 'Nobody named, `@ada` is code',
      cap: 10_000,
      mode: 'full',
    });
    expect(quiet.text).toBe('Nobody named, `@ada` is code');
    expect(quiet.mentions).toEqual([]);
    // No mention, no directory build.
    expect(statements).toEqual([]);
  });

  it('gives a token the current name, and each language its stored form', async () => {
    const resolved = await prepareSurfaceText(members(), {
      organizationId: 'org-1',
      body: '[@Ada Byron](mention:user/u-ada) please look',
      cap: 10_000,
      mode: 'full',
      bodyByLocale: { de: '@ada bitte prüfen', fr: '@ada vérifie' },
    });
    expect(resolved.text).toBe(`${ADA_TOKEN} please look`);
    expect(resolved.bodyByLocale).toEqual({
      de: `${ADA_TOKEN} bitte prüfen`,
      fr: `${ADA_TOKEN} vérifie`,
    });
  });

  it('rewrites only what an edit adds: the handles already there stay as typed', async () => {
    const resolved = await prepareSurfaceText(members(), {
      organizationId: 'org-1',
      previousBody: '@ada please look',
      body: '@ada please look; @ada again',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.text).toBe(`@ada please look; ${ADA_TOKEN} again`);
    expect(resolved.added).toEqual([]);
  });

  it('keeps an imported text’s typed names, checking only its tokens', async () => {
    const resolved = await prepareSurfaceText(members(), {
      organizationId: 'org-1',
      body: '@ada from GitHub, [@Root](mention:user/u-root)',
      cap: 10_000,
      mode: 'tokens',
    });
    expect(resolved.text).toBe('@ada from GitHub, \\@Root');
  });
});

describe('a mention of someone who cannot be mentioned is saved as plain text [COLLAB-R12]', () => {
  const members = fakeDb((text) =>
    text.startsWith('SELECT m."userId"') ? [ADA] : [],
  );

  it('turns a token naming nobody mentionable into escaped text and reports it', async () => {
    const resolved = await prepareSurfaceText(members, {
      organizationId: 'org-1',
      body: 'Ping [@Grace Hopper](mention:user/u-grace) and [@Bot](mention:agent/a-elsewhere)',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.text).toBe('Ping \\@Grace Hopper and \\@Bot');
    expect(resolved.mentions).toEqual([]);
    expect(resolved.unresolvedMentionTokens).toEqual(['Grace Hopper', 'Bot']);
    expect(resolved.invalidTokens).toEqual([
      { type: 'user', id: 'u-grace' },
      { type: 'agent', id: 'a-elsewhere' },
    ]);
  });

  it('keeps a token an edited text already had, as it was', async () => {
    const token = '[@Grace Hopper](mention:user/u-grace)';
    const resolved = await prepareSurfaceText(members, {
      organizationId: 'org-1',
      previousBody: `${token} owns this`,
      body: `${token} owns this, cc @ada`,
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.text).toBe(`${token} owns this, cc ${ADA_TOKEN}`);
    expect(resolved.invalidTokens).toEqual([]);
  });

  it('refuses nothing and rewrites nothing in the verbatim lane, naming the bad tokens', async () => {
    const body = 'Ping [@Grace Hopper](mention:user/u-grace) and @ada';
    const resolved = await prepareSurfaceText(members, {
      organizationId: 'org-1',
      body,
      cap: 10_000,
      mode: 'verbatim',
    });
    expect(resolved.text).toBe(body);
    expect(resolved.invalidTokens).toEqual([{ type: 'user', id: 'u-grace' }]);
  });
});

describe('the agents of a project in the directory [COLLAB-R11]', () => {
  const agents = (rows: Row[]) =>
    fakeDb((text) => {
      if (text.startsWith('SELECT m."userId"')) {
        return [{ ...ADA, email: 'invoice-checker@example.com' }];
      }
      if (text.includes('FROM app.projects')) return [{ teamIds: [] }];
      if (text.includes('FROM app.project_agents')) return rows;
      return [];
    });

  it('names an agent by its handle, its older forms and its id; a handle never takes a person’s email name', async () => {
    vi.mocked(listAutomations).mockResolvedValue([]);
    const db = agents([
      {
        id: 'a-qa',
        name: 'QA Bot',
        handle: 'qa-bot',
        legacyHandles: ['research.bot', 'researchbot'],
        createdAt: 1,
      },
      {
        id: 'a-invoice',
        name: 'Invoice checker',
        handle: 'invoice-checker',
        legacyHandles: [],
        createdAt: 2,
      },
    ]);
    const resolved = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      projectId: 'proj-1',
      body: '@qa-bot, @research.bot, @a-qa and @invoice-checker',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.mentions).toEqual([
      { type: 'agent', id: 'a-qa' },
      { type: 'user', id: 'u-ada' },
    ]);
  });

  it('gives an agent the previous release added the handle its next save stores', async () => {
    vi.mocked(listAutomations).mockResolvedValue([]);
    const db = agents([
      {
        id: 'a-old',
        name: 'My Opus Agent #3',
        handle: null,
        legacyHandles: null,
        createdAt: 1,
      },
    ]);
    const resolved = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      projectId: 'proj-1',
      body: '@my-opus-agent-3 please review',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.text).toBe(
      '[@My Opus Agent #3](mention:agent/a-old) please review',
    );
  });
});

describe('the current names of whoever tokens name', () => {
  it('reads each kind once, and leaves out people no longer in the organization', async () => {
    const statements: string[] = [];
    const db = fakeDb((text) => {
      if (text.includes('FROM "user" u')) {
        return [{ id: 'u-ada', name: 'Ada King', email: 'ada@example.com' }];
      }
      if (text.includes('FROM app.project_agents')) {
        return [{ id: 'a-qa', name: 'QA Bot' }];
      }
      if (text.includes('FROM app.automations')) {
        return [{ name: 'vat', presentation: { name: 'VAT desk' } }];
      }
      return [];
    }, statements);
    const names = await currentMentionNames(db, 'org-1', [
      `${ADA_TOKEN} [@Gone](mention:user/u-gone)`,
      '[@Research Bot](mention:agent/a-qa) [@vat](mention:automation/vat)',
    ]);
    expect(Object.fromEntries(names)).toEqual({
      'user:u-ada': 'Ada King',
      'agent:a-qa': 'QA Bot',
      'automation:vat': 'VAT desk',
    });
    expect(statements).toHaveLength(3);
  });
});
