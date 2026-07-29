// @vitest-environment node

/**
 * The access rule behind the chat REST surface, against the real tables.
 *
 * A thread is USER-private. The handlers pass an identity resolved from an API
 * key, so the whole tenancy story rests on these functions scoping by the
 * `(organizationId, userId)` pair — not by organization alone. This suite is
 * written to FAIL if that ever loosens: every read is attempted a second time as
 * a different member of the same organization, and as the same user in another
 * organization, and must come back absent both times.
 *
 * A foreign thread reads as ABSENT rather than forbidden, deliberately: the
 * handler turns that into 404, so an API key cannot even confirm that another
 * member's conversation exists.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'chat';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_chat_rest';
const OTHER_ORG = 'org_chat_other';
const OWNER = 'user_owner';
const OTHER_MEMBER = 'user_other_member';

type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

interface SeedOptions {
  readonly organizationId?: string;
  readonly userId?: string;
  readonly kind?: 'direct' | 'sandbox';
  readonly title?: string;
  readonly generating?: boolean;
  readonly messages?: number;
}

async function seedThread(t: T, options: SeedOptions = {}): Promise<string> {
  const organizationId = options.organizationId ?? ORG;
  const userId = options.userId ?? OWNER;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const threadId = await ctx.db.insert('threads', {
      organizationId,
      userId,
      kind: options.kind ?? 'direct',
      ...(options.title !== undefined && { title: options.title }),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < (options.messages ?? 0); index++) {
      await ctx.db.insert('messages', {
        organizationId,
        threadId,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `turn ${index}` }],
        sequence: index,
        createdAt: now + index,
      });
    }
    if (options.generating === true) {
      await ctx.db.insert('generations', {
        organizationId,
        threadId,
        status: 'streaming',
        streamId: 'stream_1',
        messageId: 'msg_1',
        startedAt: now,
        heartbeatAt: now,
      });
    }
    return threadId;
  });
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

describe('cross-user isolation', () => {
  it('hides another member thread from every read', async () => {
    const t = newWorld();
    const threadId = await seedThread(t, {
      title: 'Private',
      messages: 2,
      generating: true,
    });

    const asOwner = { organizationId: ORG, userId: OWNER, threadId };
    const asOther = { organizationId: ORG, userId: OTHER_MEMBER, threadId };

    expect(
      await t.query(internal.chat.rest_support.restGetThread, asOwner),
    ).toMatchObject({ id: threadId, title: 'Private', generating: true });
    expect(
      await t.query(internal.chat.rest_support.restGetThread, asOther),
    ).toBeNull();

    expect(
      await t.query(internal.chat.rest_support.restListMessages, {
        ...asOwner,
        cursor: null,
        limit: 10,
      }),
    ).toMatchObject({ isDone: true });
    expect(
      await t.query(internal.chat.rest_support.restListMessages, {
        ...asOther,
        cursor: null,
        limit: 10,
      }),
    ).toBeNull();

    expect(
      await t.query(internal.chat.rest_support.restGetGeneration, asOwner),
    ).toMatchObject({ status: 'streaming' });
    expect(
      await t.query(internal.chat.rest_support.restGetGeneration, asOther),
    ).toBeNull();
  });

  it('hides a thread of the same user in another organization', async () => {
    const t = newWorld();
    const threadId = await seedThread(t, {
      organizationId: OTHER_ORG,
      userId: OWNER,
      messages: 1,
    });

    expect(
      await t.query(internal.chat.rest_support.restGetThread, {
        organizationId: ORG,
        userId: OWNER,
        threadId,
      }),
    ).toBeNull();
    expect(
      await t.query(internal.chat.rest_support.restListMessages, {
        organizationId: ORG,
        userId: OWNER,
        threadId,
        cursor: null,
        limit: 10,
      }),
    ).toBeNull();
  });

  it('lists only the asking user threads, newest first', async () => {
    const t = newWorld();
    await seedThread(t, { title: 'Mine A' });
    await seedThread(t, { title: 'Mine B' });
    await seedThread(t, { title: 'Theirs', userId: OTHER_MEMBER });
    await seedThread(t, { title: 'Elsewhere', organizationId: OTHER_ORG });

    const mine = await t.query(internal.chat.rest_support.restListThreads, {
      organizationId: ORG,
      userId: OWNER,
      cursor: null,
      limit: 10,
    });
    expect(mine.page.map((row) => row.title)).toEqual(['Mine B', 'Mine A']);

    const theirs = await t.query(internal.chat.rest_support.restListThreads, {
      organizationId: ORG,
      userId: OTHER_MEMBER,
      cursor: null,
      limit: 10,
    });
    expect(theirs.page.map((row) => row.title)).toEqual(['Theirs']);
  });

  it('reads a malformed thread id as absent rather than throwing', async () => {
    const t = newWorld();
    expect(
      await t.query(internal.chat.rest_support.restGetThread, {
        organizationId: ORG,
        userId: OWNER,
        threadId: 'nonsense',
      }),
    ).toBeNull();
  });
});

describe('restListThreads and restListMessages pagination', () => {
  it('pages threads with a cursor', async () => {
    const t = newWorld();
    await seedThread(t, { title: 'One' });
    await seedThread(t, { title: 'Two' });
    await seedThread(t, { title: 'Three' });

    const first = await t.query(internal.chat.rest_support.restListThreads, {
      organizationId: ORG,
      userId: OWNER,
      cursor: null,
      limit: 2,
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);

    const second = await t.query(internal.chat.rest_support.restListThreads, {
      organizationId: ORG,
      userId: OWNER,
      cursor: first.continueCursor,
      limit: 2,
    });
    expect(second.page.map((row) => row.title)).toEqual(['One']);
  });

  it('pages messages in sequence order', async () => {
    const t = newWorld();
    const threadId = await seedThread(t, { messages: 3 });
    const page = await t.query(internal.chat.rest_support.restListMessages, {
      organizationId: ORG,
      userId: OWNER,
      threadId,
      cursor: null,
      limit: 2,
    });
    expect(page?.page.map((row) => row.sequence)).toEqual([0, 1]);
    expect(page?.isDone).toBe(false);
  });
});

/**
 * The scheduled turn re-checks the identity it was handed. It runs DETACHED from
 * the request that scheduled it, so the HTTP layer's checks are not a substitute:
 * a turn must refuse a thread the named user does not own even if it is asked to
 * run one.
 */
describe('startTurnForApiKey', () => {
  it('refuses a thread the named user does not own, and writes nothing', async () => {
    const t = newWorld();
    const threadId = await seedThread(t, { messages: 1 });

    const outcome = await t.action(
      internal.chat.turn_action.startTurnForApiKey,
      {
        organizationId: ORG,
        userId: OTHER_MEMBER,
        threadId,
        userText: 'let me in',
        modelId: 'gpt-5',
      },
    );
    expect(outcome).toEqual({
      status: 'refused',
      reason: 'This conversation does not exist.',
    });
    const messages = await t.run(
      async (ctx) => await ctx.db.query('messages').collect(),
    );
    expect(messages).toHaveLength(1);
  });

  it('refuses a thread that is already generating', async () => {
    const t = newWorld();
    const threadId = await seedThread(t, { generating: true });

    const outcome = await t.action(
      internal.chat.turn_action.startTurnForApiKey,
      {
        organizationId: ORG,
        userId: OWNER,
        threadId,
        userText: 'again',
        modelId: 'gpt-5',
      },
    );
    expect(outcome).toEqual({
      status: 'refused',
      reason: 'This conversation is already generating a response.',
    });
  });

  it('records a pre-pipeline failure as an assistant error, so it is visible', async () => {
    const t = newWorld();
    const threadId = await seedThread(t);

    // Resolution fails in this world (no model catalog, no organization row) —
    // which is exactly the class of failure that happens BEFORE the turn
    // pipeline opens a generation, and would otherwise leave a scheduled turn
    // with nowhere to report itself. Whichever resolution trips first, the
    // caller must be able to see it by reading the thread.
    const outcome = await t.action(
      internal.chat.turn_action.startTurnForApiKey,
      {
        organizationId: ORG,
        userId: OWNER,
        threadId,
        userText: 'hello',
        modelId: 'no-such-model',
      },
    );
    expect(outcome.status).toBe('refused');
    expect(outcome.reason).toBeTruthy();

    const messages = await t.run(
      async (ctx) => await ctx.db.query('messages').collect(),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      model: 'no-such-model',
      // Stored as the structured envelope; the raw reason is inside it.
      error: expect.stringContaining(outcome.reason ?? ''),
    });
    // No generation row is left behind for the poll to hang on.
    expect(
      await t.run(async (ctx) => await ctx.db.query('generations').collect()),
    ).toHaveLength(0);
  });
});

describe('restCreateThread', () => {
  it('creates a thread owned by the given user', async () => {
    const t = newWorld();
    const threadId = await t.mutation(
      internal.chat.rest_support.restCreateThread,
      {
        organizationId: ORG,
        userId: OWNER,
        kind: 'direct',
        title: 'From the API',
      },
    );
    const row = await t.run(
      async (ctx) => await ctx.db.get(threadId as Id<'threads'>),
    );
    expect(row).toMatchObject({
      organizationId: ORG,
      userId: OWNER,
      kind: 'direct',
      title: 'From the API',
      archived: false,
    });
  });

  it('refuses a projectId that is not an id', async () => {
    const t = newWorld();
    const error = await t
      .mutation(internal.chat.rest_support.restCreateThread, {
        organizationId: ORG,
        userId: OWNER,
        kind: 'direct',
        projectId: 'not-an-id',
      })
      .then(
        () => {
          throw new Error('expected the call to be refused');
        },
        (err: unknown) => err,
      );
    expect(codeOf(error)).toBe('PROJECT_NOT_FOUND');
  });

  it('refuses a project the user cannot read', async () => {
    const t = newWorld();
    const projectId = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: OTHER_ORG,
        name: 'Someone else',
        createdBy: OTHER_MEMBER,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const error = await t
      .mutation(internal.chat.rest_support.restCreateThread, {
        organizationId: ORG,
        userId: OWNER,
        kind: 'direct',
        projectId,
      })
      .then(
        () => {
          throw new Error('expected the call to be refused');
        },
        (err: unknown) => err,
      );
    // Refused through the SAME gate `createThread` uses, with the same code it
    // reports for an inaccessible-but-resolvable project — no thread is created
    // either way, so a project the caller cannot read can never adopt one.
    expect(codeOf(error)).toBe('PROJECT_FORBIDDEN');
    expect(
      await t.run(async (ctx) => await ctx.db.query('threads').collect()),
    ).toHaveLength(0);
  });
});
