import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listAutomations } from '../automations/store.ts';
import { lookupMembers } from '../members/service.ts';
import {
  currentMentionNames,
  MentionDirectoryError,
  prepareSurfaceText,
} from './mention-directory.ts';

vi.mock('../automations/store.ts', () => ({ listAutomations: vi.fn() }));
// The real lookup, watched: which members a directory asks for.
vi.mock('../members/service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../members/service.ts')>();
  return { ...actual, lookupMembers: vi.fn(actual.lookupMembers) };
});

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

/** The member lookup (`lookupMembers`), the one statement a directory reads
 * members with. A fake answers it with everyone: the lookup itself keeps
 * only the members who answer to what was asked, as the database does. */
const isMemberLookup = (text: string) => text.includes('FROM "member" m');

const ADA = {
  id: 'm-ada',
  userId: 'u-ada',
  role: 'member',
  createdAt: '2026-01-01 09:00:00+00',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
};

describe('mention directory — a leg that cannot be listed fails loudly [COLLAB-R5]', () => {
  it('a failed member listing rejects instead of turning @teammate into text', async () => {
    // The old contract logged and returned a partial directory: the comment
    // posted, but the named teammate got no bell and nothing told the
    // author. The surface must fail (retryable) instead.
    const db = fakeDb((text) => {
      if (isMemberLookup(text)) {
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
      if (isMemberLookup(text)) return [ADA];
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
    const db = fakeDb((text) => (isMemberLookup(text) ? [ADA] : []));
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
      if (isMemberLookup(text)) throw conflict;
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

  it('a member lookup that fails for the agents’ handles is the members leg’s outage', async () => {
    // The agents leg reads the members an agent's handle could clash with;
    // the log and the error name the read that failed, not the agents.
    vi.mocked(listAutomations).mockResolvedValueOnce([]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let lookups = 0;
    const db = fakeDb((text) => {
      if (isMemberLookup(text)) {
        lookups += 1;
        if (lookups > 1) throw new Error('connection reset');
        return [ADA];
      }
      if (text.includes('FROM app.projects')) return [{ teamIds: [] }];
      if (text.includes('FROM app.project_agents')) {
        return [
          {
            id: 'a-qa',
            name: 'QA bot',
            handle: 'qa-bot',
            legacyHandles: [],
            createdAt: 1,
          },
        ];
      }
      return [];
    });

    await expect(
      prepareSurfaceText(db, {
        organizationId: 'org-1',
        projectId: 'proj-1',
        body: '@ada ship it',
        cap: 10_000,
        mode: 'full',
      }),
    ).rejects.toMatchObject({ leg: 'members', status: 503 });
    expect(lookups).toBe(2);
    expect(logged.mock.calls.map(([message]) => message)).toEqual([
      '[collab] mention directory: members listing failed',
    ]);
    logged.mockRestore();
  });
});

describe('mention directory — an edit names only who it adds [COLLAB-R4]', () => {
  const BOB = {
    id: 'm-bob',
    userId: 'u-bob',
    role: 'member',
    createdAt: '2026-01-02 09:00:00+00',
    email: 'bob@example.com',
    displayName: 'Bob Stone',
  };
  const members = fakeDb((text) => (isMemberLookup(text) ? [ADA, BOB] : []));

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
    fakeDb((text) => (isMemberLookup(text) ? [ADA] : []), statements);

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
  const members = fakeDb((text) => (isMemberLookup(text) ? [ADA] : []));

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
      if (isMemberLookup(text)) {
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

describe('an agent whose handle someone else came to answer to moves on [PROJ-R19]', () => {
  it('answers to the next free handle, as its reads show and its next save stores', async () => {
    // Marco saved a draft automation `invoice-checker` after Ines's agent
    // took that handle: the agent answers to `@invoice-checker-02`, and the
    // draft, which nobody can mention, still keeps `@invoice-checker`.
    vi.mocked(listAutomations).mockResolvedValue([
      {
        name: 'invoice-checker',
        latestVersion: 1,
        deployedVersion: null,
        description: null,
        inputs: null,
        presentation: null,
        projectIds: [],
        trigger: null,
      },
    ]);
    const db = fakeDb((text) => {
      if (isMemberLookup(text)) return [ADA];
      if (text.includes('FROM app.projects')) return [{ teamIds: [] }];
      if (text.includes('FROM app.project_agents')) {
        return [
          {
            id: 'a-invoice',
            name: 'Invoice checker',
            handle: 'invoice-checker',
            legacyHandles: [],
            createdAt: 1,
          },
        ];
      }
      return [];
    });
    const resolved = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      projectId: 'proj-1',
      body: '@invoice-checker-02 and @invoice-checker',
      cap: 10_000,
      mode: 'full',
    });
    expect(resolved.mentions).toEqual([{ type: 'agent', id: 'a-invoice' }]);
    expect(resolved.unresolvedMentionTokens).toEqual(['invoice-checker']);
  });
});

describe('a directory reads only the members a text names', () => {
  beforeEach(() => {
    vi.mocked(lookupMembers).mockClear();
  });
  const askedFor = () =>
    vi.mocked(lookupMembers).mock.calls.map(([, , names]) => names);

  it('looks up the handles and people’s tokens of the text, its languages and the text an edit replaces', async () => {
    const statements: string[] = [];
    const db = fakeDb(
      (text) => (isMemberLookup(text) ? [ADA] : []),
      statements,
    );
    const resolved = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      previousBody: '@Dora please look',
      body: '@ada and [@Bob Stone](mention:user/u-bob) please look',
      bodyByLocale: { de: '@Carl bitte prüfen' },
      cap: 10_000,
      mode: 'full',
    });

    expect(askedFor()).toEqual([
      { userIds: ['u-bob'], handles: ['ada', 'carl', 'dora'] },
    ]);
    // The lookup is the one statement that reads members.
    expect(statements.filter((text) => text.includes('"member"'))).toHaveLength(
      1,
    );
    expect(resolved.mentions).toEqual([{ type: 'user', id: 'u-ada' }]);
  });

  it('moves an agent past the handles people the text does not name answer to, as when everyone was read [PROJ-R19]', async () => {
    // Ines's email name is the agent's stored handle and Marco's is the
    // next one: the agent answers to `-03`, as its reads and its project's
    // next save give it, though the text names neither of them.
    vi.mocked(listAutomations).mockResolvedValue([]);
    const ines = {
      ...ADA,
      id: 'm-ines',
      userId: 'u-ines',
      email: 'invoice-checker@example.com',
      displayName: 'Ines Roth',
    };
    const marco = {
      ...ADA,
      id: 'm-marco',
      userId: 'u-marco',
      email: 'invoice-checker-02@example.com',
      displayName: 'Marco Brun',
    };
    const db = fakeDb((text) => {
      if (isMemberLookup(text)) return [ines, marco];
      if (text.includes('FROM app.projects')) return [{ teamIds: [] }];
      if (text.includes('FROM app.project_agents')) {
        return [
          {
            id: 'a-invoice',
            name: 'Invoice checker',
            handle: 'invoice-checker',
            legacyHandles: [],
            createdAt: 1,
          },
        ];
      }
      return [];
    });

    const resolved = await prepareSurfaceText(db, {
      organizationId: 'org-1',
      projectId: 'proj-1',
      body: '@invoice-checker-03 please check',
      cap: 10_000,
      mode: 'full',
    });

    expect(resolved.text).toBe(
      '[@Invoice checker](mention:agent/a-invoice) please check',
    );
    // The text's handle, then each handle the agent holds or is given,
    // once: never the whole organization.
    expect(askedFor()).toEqual([
      { userIds: [], handles: ['invoice-checker-03'] },
      { userIds: [], handles: ['invoice-checker'] },
      { userIds: [], handles: ['invoice-checker-02'] },
    ]);
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
