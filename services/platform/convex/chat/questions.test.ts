/**
 * The pending-question read, against real rows.
 *
 * This suite exists because the first version of `getPendingQuestion` gated on
 * `canAccessThread`, which reads `threadMetadata` — a table the rewritten chat
 * pipeline never writes. It returned null for every chat thread, so the query
 * answered "nothing pending" no matter how correct the approval row was, and
 * the panel could not render. Typecheck, type-aware lint and the whole unit
 * suite were green throughout: nothing exercised the query against a thread
 * that actually existed.
 *
 * So the case that matters most here is the boring one — an owner reading
 * their own pending question and GETTING it.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
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

type T = TestConvex<typeof schema>;

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const ALICE = 'user_alice';
const BOB = 'user_bob';

const SET = {
  questions: [
    {
      id: 'purpose',
      question: "What's the purpose of this email?",
      options: [{ label: 'Request an approval' }, { label: 'Follow up' }],
    },
  ],
};

async function seedThread(
  t: T,
  organizationId: string,
  userId: string,
): Promise<Id<'threads'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('threads', {
      organizationId,
      userId,
      kind: 'direct',
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function as(t: T, userId: string) {
  return t.withIdentity({ subject: userId });
}

describe('getPendingQuestion', () => {
  it('gives the owner the question their thread is waiting on', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.questions.createQuestionRequestInternal, {
      organizationId: ORG_A,
      threadId,
      set: SET,
    });

    const pending = await as(t, ALICE).query(
      api.chat.questions.getPendingQuestion,
      { organizationId: ORG_A, threadId },
    );

    expect(pending).not.toBeNull();
    expect(pending?.set.questions[0]?.question).toBe(
      "What's the purpose of this email?",
    );
  });

  it('answers null when the thread has nothing pending', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    expect(
      await as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_A,
        threadId,
      }),
    ).toBeNull();
  });

  it("does not hand one member another's question", async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.questions.createQuestionRequestInternal, {
      organizationId: ORG_A,
      threadId,
      set: SET,
    });
    expect(
      await as(t, BOB).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_A,
        threadId,
      }),
    ).toBeNull();
  });

  it('does not leak across organizations', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.questions.createQuestionRequestInternal, {
      organizationId: ORG_A,
      threadId,
      set: SET,
    });
    expect(
      await as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_B,
        threadId,
      }),
    ).toBeNull();
  });

  // Two panels cannot share one composer, so the newer question wins.
  it('supersedes an older question rather than stacking', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.questions.createQuestionRequestInternal, {
      organizationId: ORG_A,
      threadId,
      set: SET,
    });
    await t.mutation(internal.chat.questions.createQuestionRequestInternal, {
      organizationId: ORG_A,
      threadId,
      set: {
        questions: [
          {
            id: 'tone',
            question: 'What tone should it take?',
            options: [{ label: 'Formal' }, { label: 'Warm' }],
          },
        ],
      },
    });

    const pending = await as(t, ALICE).query(
      api.chat.questions.getPendingQuestion,
      { organizationId: ORG_A, threadId },
    );
    expect(pending?.set.questions[0]?.question).toBe(
      'What tone should it take?',
    );
    const open = await t.run(async (ctx) =>
      ctx.db
        .query('approvals')
        .withIndex('by_threadId_status_resourceType', (q) =>
          q
            .eq('threadId', threadId)
            .eq('status', 'pending')
            .eq('resourceType', 'human_input_request'),
        )
        .collect(),
    );
    expect(open).toHaveLength(1);
  });
});

describe('resolveQuestion', () => {
  it('clears the question once it is answered', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );

    await as(t, ALICE).mutation(api.chat.questions.resolveQuestion, {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'answered',
    });

    expect(
      await as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_A,
        threadId,
      }),
    ).toBeNull();
  });

  // A typed message must never leave the thread stuck on a question nobody
  // wants to answer.
  it('clears it when the person says something else instead', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );

    await as(t, ALICE).mutation(api.chat.questions.resolveQuestion, {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'superseded',
    });

    expect(
      await as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_A,
        threadId,
      }),
    ).toBeNull();
  });

  it('lets a double-submit pass without erroring', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );
    const args = {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'answered' as const,
    };
    await as(t, ALICE).mutation(api.chat.questions.resolveQuestion, args);
    await expect(
      as(t, ALICE).mutation(api.chat.questions.resolveQuestion, args),
    ).resolves.toBeNull();
  });

  it("refuses to let one member answer another's question", async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );

    await as(t, BOB).mutation(api.chat.questions.resolveQuestion, {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'answered',
    });

    // Still pending for the owner.
    expect(
      await as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_A,
        threadId,
      }),
    ).not.toBeNull();
  });
});

/**
 * The transcript row is the only lasting trace of the ask — the panel that
 * collects the answer disappears the moment it resolves. Its badge derived
 * "answered" from an `answer` field NOTHING ever filled in, so a question the
 * person had long since dealt with kept insisting their answer was needed for
 * the rest of the thread's life.
 */
describe('resolveQuestion stamps the transcript row', () => {
  async function seedAsk(
    t: T,
    threadId: Id<'threads'>,
    requestId: string,
  ): Promise<Id<'messages'>> {
    return t.run(async (ctx) =>
      ctx.db.insert('messages', {
        organizationId: ORG_A,
        threadId,
        role: 'assistant',
        parts: [
          { type: 'tool-call', callId: 'c1', capabilityId: 'ask_question' },
          {
            type: 'human-input',
            requestId,
            question: "What's the purpose of this email?",
            questionCount: 1,
          },
        ],
        sequence: 1,
        createdAt: 0,
      }),
    );
  }

  async function partOf(t: T, messageId: Id<'messages'>) {
    return t.run(async (ctx) => {
      const message = await ctx.db.get(messageId);
      const parts = Array.isArray(message?.parts) ? message.parts : [];
      return parts.find(
        (part: unknown) =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: string }).type === 'human-input',
      ) as { outcome?: string; answer?: string } | undefined;
    });
  }

  it('marks the row answered', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );
    const messageId = await seedAsk(t, threadId, requestId);

    await as(t, ALICE).mutation(api.chat.questions.resolveQuestion, {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'answered',
    });

    expect(await partOf(t, messageId)).toMatchObject({ outcome: 'answered' });
  });

  it('marks the row skipped when the person moved on instead', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );
    const messageId = await seedAsk(t, threadId, requestId);

    await as(t, ALICE).mutation(api.chat.questions.resolveQuestion, {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'superseded',
    });

    expect((await partOf(t, messageId))?.outcome).toBe('skipped');
  });

  // A row that cannot be found must not fail the answer — the question is
  // still resolved, the transcript just keeps its neutral marker.
  it('still resolves when there is no transcript row to stamp', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const requestId = await t.mutation(
      internal.chat.questions.createQuestionRequestInternal,
      { organizationId: ORG_A, threadId, set: SET },
    );

    await as(t, ALICE).mutation(api.chat.questions.resolveQuestion, {
      organizationId: ORG_A,
      requestId: requestId as Id<'approvals'>,
      outcome: 'answered',
    });

    expect(
      await as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
        organizationId: ORG_A,
        threadId,
      }),
    ).toBeNull();
  });
});

/**
 * The question's lifetime is DERIVED, not recorded.
 *
 * It used to depend on `resolveQuestion` landing. When that write was
 * rejected the question stayed offered forever — above the reply to the very
 * answers meant to close it — and suppressing it on the client only held
 * until the next reload, because that state lives in a component.
 *
 * Anything the person has said since the question settles it, and the thread
 * already carries that fact.
 */
describe('getPendingQuestion — the conversation moving on', () => {
  async function say(
    t: T,
    threadId: Id<'threads'>,
    role: 'user' | 'assistant',
    createdAt: number,
    sequence: number,
  ): Promise<void> {
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        organizationId: ORG_A,
        threadId,
        role,
        parts: [{ type: 'text', text: 'hi' }],
        sequence,
        createdAt,
      });
    });
  }

  async function ask(t: T, threadId: Id<'threads'>): Promise<string> {
    return t.mutation(internal.chat.questions.createQuestionRequestInternal, {
      organizationId: ORG_A,
      threadId,
      set: SET,
    });
  }

  function read(t: T, threadId: Id<'threads'>) {
    return as(t, ALICE).query(api.chat.questions.getPendingQuestion, {
      organizationId: ORG_A,
      threadId,
    });
  }

  it('stops offering the question once the person has said anything since', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await ask(t, threadId);
    expect(await read(t, threadId)).not.toBeNull();

    // The answer, sent as their next message — no resolveQuestion involved.
    await say(t, threadId, 'user', Date.now() + 60_000, 5);

    expect(await read(t, threadId)).toBeNull();
  });

  it('keeps offering it while only the assistant has spoken since', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await ask(t, threadId);
    await say(t, threadId, 'assistant', Date.now() + 60_000, 5);

    expect(await read(t, threadId)).not.toBeNull();
  });

  // The message that PROMPTED the question must not read as an answer to it.
  it('ignores what was said before the question was asked', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await say(t, threadId, 'user', Date.now() - 60_000, 1);
    await ask(t, threadId);

    expect(await read(t, threadId)).not.toBeNull();
  });
});
