// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { VIDEO_LINK_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { BackendApiError } from './api-client';
import { budgetScopeOf } from './budget-refusal';
import {
  applySettledChatMessage,
  chatMessagesQuery,
  chatWholeMessagesQuery,
  keepOlderChatMessages,
  loadEarlierChatMessages,
  sendChatTurn,
  type ChatMessageCursor,
  type ChatMessagePage,
  videoJobsForThreadQuery,
  videoJobsPollInterval,
  videoJobsUnboundQuery,
} from './chat';

/** zod's sentence for a string past its `max`, as the send door words it. */
const TOO_BIG = 'Too big: expected string to have <=200000 characters';

/**
 * A refusal's toast used to be picked by matching its English sentence; a
 * reached budget cap now names itself with a code, and the send hands that
 * code to the caller beside the reason.
 */
describe('sendChatTurn', () => {
  it('hands a refusal’s code to the caller beside its reason, and whose cap it names', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          status: 'refused',
          code: 'BUDGET_EXCEEDED',
          reason: 'Usage limit reached.',
          persisted: false,
          data: { scope: 'user', period: 'daily' },
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(
        sendChatTurn('org1', 't1', { text: 'hello', modelId: 'model-a' }),
      ).resolves.toEqual({
        status: 'refused',
        reason: 'Usage limit reached.',
        code: 'BUDGET_EXCEEDED',
        budgetScope: 'user',
        persisted: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads the scope of the cap a refusal names, and none from anything else', () => {
    expect(budgetScopeOf({ scope: 'project', projectId: 'p1' })).toBe(
      'project',
    );
    for (const data of [undefined, null, 'project', {}, { scope: 7 }]) {
      expect(budgetScopeOf(data)).toBeUndefined();
    }
  });

  // A 4xx that is no turn refusal — the door refusing the request itself —
  // used to become "Turn request failed with status 400", dropping the
  // door's own code and message.
  // The body is the door's own answer (`invalidBodyResponse`) to a text
  // past the send schema's 200,000 characters.
  it("throws a request the door refused with the door's code and message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: 'invalid body',
            message: `text: ${TOO_BIG}`,
            data: { issues: [{ path: 'text', message: TOO_BIG }] },
          },
          { status: 400 },
        ),
      ),
    );
    try {
      const error: unknown = await sendChatTurn('org1', 't1', {
        text: 'hello',
        modelId: 'model-a',
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BackendApiError);
      expect(error).toMatchObject({
        status: 400,
        code: 'invalid body',
        message: `text: ${TOO_BIG}`,
        data: { issues: [{ path: 'text', message: TOO_BIG }] },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('carries a bare code as the message when the door sends no sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'thread not found' }, { status: 404 }),
      ),
    );
    try {
      await expect(
        sendChatTurn('org1', 't1', { text: 'hello', modelId: 'model-a' }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'thread not found',
        message: 'thread not found',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the status text for an answer that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad Gateway', { status: 502 })),
    );
    try {
      await expect(
        sendChatTurn('org1', 't1', { text: 'hello', modelId: 'model-a' }),
      ).rejects.toMatchObject({
        status: 502,
        message: 'Request failed with status 502',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * An idle chat page used to ask `/video-links/thread/{id}` every two
 * seconds, forever, to learn that an empty list was still empty — at 500
 * open tabs that is 220 requests a second carrying eleven bytes each. The
 * backend now hints the uploader on every job write, so the chip reads key
 * under that entity and poll only as a fallback while a job is live.
 */
describe('the video-link chip reads', () => {
  it('key both reads under the entity the backend hints', () => {
    // `use-backend-hints.ts` invalidates `['backend', orgId, hint.entity]`;
    // a key under any other name would never hear the hint.
    expect(videoJobsForThreadQuery('org1', 't1').queryKey.slice(0, 3)).toEqual([
      'backend',
      'org1',
      VIDEO_LINK_HINT_ENTITY,
    ]);
    expect(videoJobsUnboundQuery('org1').queryKey.slice(0, 3)).toEqual([
      'backend',
      'org1',
      VIDEO_LINK_HINT_ENTITY,
    ]);
  });

  it('do not poll before the first answer or once every job has settled', () => {
    expect(videoJobsPollInterval(undefined)).toBe(false);
    expect(videoJobsPollInterval([])).toBe(false);
    expect(
      videoJobsPollInterval([
        { displayStatus: 'completed' },
        { displayStatus: 'failed' },
        { displayStatus: 'skipped' },
      ]),
    ).toBe(false);
  });

  it.each([
    'queued',
    'retrying',
    'fetching_metadata',
    'fetching_captions',
    'extracting_audio',
    'transcribing_handoff',
    'indexing',
    'some_state_added_later',
  ])('keep a slow fallback poll while a job is %s', (displayStatus) => {
    expect(
      videoJobsPollInterval([
        { displayStatus: 'completed' },
        { displayStatus },
      ]),
    ).toBe(5_000);
  });

  it('wire the interval as a function of the answer on both reads', () => {
    for (const options of [
      videoJobsForThreadQuery('org1', 't1'),
      videoJobsUnboundQuery('org1'),
    ]) {
      expect(typeof options.refetchInterval).toBe('function');
    }
  });
});

/**
 * The transcript reads one page at a time: the newest on open and on every
 * nudge, the older ones on demand, and a settled turn's row from the stream
 * without a read. A re-read must keep the older rows already loaded.
 */
describe('the transcript’s pages', () => {
  type Row = ChatMessagePage['messages'][number];
  const row = (id: string, sequence: number, text = id): Row => ({
    id,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', text }],
    sequence,
    model: undefined,
    providerSlug: undefined,
    usage: undefined,
    blockedReason: undefined,
    error: undefined,
    createdAt: sequence,
  });
  const page = (
    messages: Row[],
    nextBefore: ChatMessageCursor | null = null,
  ): ChatMessagePage => ({
    messages,
    hasMore: nextBefore !== null,
    nextBefore,
  });

  /** A backend answering each page read from `pages`, keyed by its cursor
   * (the query string without the org), and recording every read's. */
  function stubPages(pages: Record<string, ChatMessagePage>) {
    const reads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const { searchParams } = new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          'http://localhost',
        );
        searchParams.delete('orgId');
        const cursor = searchParams.size === 0 ? '' : `?${searchParams}`;
        reads.push(cursor);
        const answer = pages[cursor];
        return answer === undefined
          ? Response.json({ error: 'not found' }, { status: 404 })
          : Response.json({ thread: {}, ...answer });
      }),
    );
    return { pages, reads };
  }

  const key = ['backend', 'org1', 'chat_message', 't1'];

  it('re-reads the newest page only, and keeps the older pages in front of it', async () => {
    const queryClient = new QueryClient();
    const backend = stubPages({
      '': page([row('m3', 3), row('m4', 4)], { order: 3, stepOrder: 0 }),
      '?beforeOrder=3&beforeStep=0': page([row('m1', 1), row('m2', 2)]),
    });
    try {
      await queryClient.fetchQuery(chatMessagesQuery('org1', 't1'));
      await expect(
        loadEarlierChatMessages(queryClient, 'org1', 't1'),
      ).resolves.toBe(true);
      expect(queryClient.getQueryData(key)).toEqual(
        page(['m1', 'm2', 'm3', 'm4'].map((id, at) => row(id, at + 1))),
      );

      // A turn added m5 and rewrote m4; the newest page now starts at m4.
      backend.pages[''] = page([row('m4', 4, 'rewritten'), row('m5', 5)], {
        order: 4,
        stepOrder: 0,
      });
      await queryClient.refetchQueries({ queryKey: key });

      expect(queryClient.getQueryData(key)).toEqual(
        page([
          row('m1', 1),
          row('m2', 2),
          row('m3', 3),
          row('m4', 4, 'rewritten'),
          row('m5', 5),
        ]),
      );
      expect(backend.reads).toEqual(['', '?beforeOrder=3&beforeStep=0', '']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a loaded row at the cursor’s own sequence the page does not carry', () => {
    const loaded = page([row('m2a', 2), row('m2b', 2), row('m3', 3)]);
    const newest = page([row('m2b', 2), row('m3', 3), row('m4', 4)], {
      order: 2,
      stepOrder: 1,
    });

    expect(keepOlderChatMessages(loaded, newest)).toEqual(
      page([row('m2a', 2), row('m2b', 2), row('m3', 3), row('m4', 4)]),
    );
    // A page that reached the thread's start is the whole thread.
    const whole = page([row('m2b', 2), row('m3', 3)]);
    expect(keepOlderChatMessages(loaded, whole)).toBe(whole);
  });

  it('answers a newest page that does not reach the loaded rows alone, with its own cursor', () => {
    const loaded = page([row('m1', 1), row('m2', 2), row('m3', 3)], {
      order: 1,
      stepOrder: 0,
    });
    // More than a page was written while this tab read nothing: m4-m6 sit
    // between the loaded rows and the page.
    const newest = page([row('m7', 7), row('m8', 8), row('m9', 9)], {
      order: 7,
      stepOrder: 0,
    });
    expect(keepOlderChatMessages(loaded, newest)).toBe(newest);

    // A loaded row at the cursor's own sequence that the page does not carry
    // sits before the cursor: the steps between them may be unread too.
    const atCursor = page([row('m1', 1), row('m2a', 2)]);
    const fromStep = page([row('m2c', 2), row('m3', 3)], {
      order: 2,
      stepOrder: 2,
    });
    expect(keepOlderChatMessages(atCursor, fromStep)).toBe(fromStep);
  });

  it('walks back over the rows a newest page skipped, once it stands alone', async () => {
    const queryClient = new QueryClient();
    const backend = stubPages({
      '': page([row('m1', 1), row('m2', 2), row('m3', 3)]),
    });
    try {
      await queryClient.fetchQuery(chatMessagesQuery('org1', 't1'));

      backend.pages[''] = page([row('m7', 7), row('m8', 8), row('m9', 9)], {
        order: 7,
        stepOrder: 0,
      });
      backend.pages['?beforeOrder=7&beforeStep=0'] = page(
        [row('m4', 4), row('m5', 5), row('m6', 6)],
        { order: 4, stepOrder: 0 },
      );
      backend.pages['?beforeOrder=4&beforeStep=0'] = page([
        row('m1', 1),
        row('m2', 2),
        row('m3', 3),
      ]);
      await queryClient.refetchQueries({ queryKey: key });
      expect(queryClient.getQueryData(key)).toEqual(
        page([row('m7', 7), row('m8', 8), row('m9', 9)], {
          order: 7,
          stepOrder: 0,
        }),
      );

      await loadEarlierChatMessages(queryClient, 'org1', 't1');
      await loadEarlierChatMessages(queryClient, 'org1', 't1');

      expect(
        queryClient
          .getQueryData<ChatMessagePage>(key)
          ?.messages.map((message) => message.id),
      ).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
      expect(queryClient.getQueryData<ChatMessagePage>(key)?.hasMore).toBe(
        false,
      );
      expect(backend.reads).toEqual([
        '',
        '',
        '?beforeOrder=7&beforeStep=0',
        '?beforeOrder=4&beforeStep=0',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts an older page in front once, however often it is asked for', async () => {
    const queryClient = new QueryClient();
    const { reads } = stubPages({
      '': page([row('m3', 3)], { order: 3, stepOrder: 0 }),
      '?beforeOrder=3&beforeStep=0': page([row('m1', 1), row('m2', 2)]),
    });
    try {
      await queryClient.fetchQuery(chatMessagesQuery('org1', 't1'));
      // Both asks find the rows beginning elsewhere once they settle.
      await expect(
        Promise.all([
          loadEarlierChatMessages(queryClient, 'org1', 't1'),
          loadEarlierChatMessages(queryClient, 'org1', 't1'),
        ]),
      ).resolves.toEqual([true, true]);
      await expect(
        loadEarlierChatMessages(queryClient, 'org1', 't1'),
      ).resolves.toBe(false);

      expect(queryClient.getQueryData(key)).toEqual(
        page([row('m1', 1), row('m2', 2), row('m3', 3)]),
      );
      // The third ask found the thread's first row in, and read nothing.
      expect(reads).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts a settled row in its place without a read', async () => {
    const queryClient = new QueryClient();
    const { reads } = stubPages({
      '': page([row('m1', 1), row('m2', 2)], { order: 1, stepOrder: 0 }),
    });
    try {
      await queryClient.fetchQuery(chatMessagesQuery('org1', 't1'));
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      applySettledChatMessage(queryClient, 'org1', 't1', row('m2', 2, 'done'));
      applySettledChatMessage(queryClient, 'org1', 't1', row('m3', 3));

      expect(queryClient.getQueryData(key)).toEqual(
        page([row('m1', 1), row('m2', 2, 'done'), row('m3', 3)], {
          order: 1,
          stepOrder: 0,
        }),
      );
      expect(reads).toEqual(['']);
      // Only a whole-thread read (none is cached here) and the deferred-send
      // tray re-read.
      expect(
        invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[2]),
      ).toEqual([
        'chat_message',
        'chat_deferred',
        'chat_message',
        'chat_deferred',
      ]);
      expect(invalidate.mock.calls[0]?.[0]).toEqual({
        queryKey: [...key, 'whole'],
        exact: true,
      });

      // A row before the loaded ones belongs to a page not read yet.
      applySettledChatMessage(queryClient, 'org1', 't1', row('m0', 0));
      expect(
        queryClient
          .getQueryData<ChatMessagePage>(key)
          ?.messages.map((message) => message.id),
      ).toEqual(['m1', 'm2', 'm3']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves a cached whole-thread read to a re-read when a turn settles', async () => {
    // As the app's reads stay fresh for five minutes.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 5 * 60_000 } },
    });
    const backend = stubPages({ '': page([row('a', 1), row('ar', 2)]) });
    try {
      await queryClient.fetchQuery(chatMessagesQuery('org1', 't1'));
      // An export opened and closed: its whole read stays cached, unwatched.
      await queryClient.fetchQuery(chatWholeMessagesQuery('org1', 't1'));

      // B opens a turn; the nudge reaches both reads, and only the open
      // transcript re-reads.
      backend.pages[''] = page([row('a', 1), row('ar', 2), row('b', 3)]);
      await queryClient.invalidateQueries({
        queryKey: key,
        refetchType: 'none',
      });
      await queryClient.refetchQueries({ queryKey: key, exact: true });

      backend.pages[''] = page([
        row('a', 1),
        row('ar', 2),
        row('b', 3),
        row('br', 4),
      ]);
      applySettledChatMessage(queryClient, 'org1', 't1', row('br', 4));

      const wholeKey = chatWholeMessagesQuery('org1', 't1').queryKey;
      expect(queryClient.getQueryData(key)).toEqual(
        page([row('a', 1), row('ar', 2), row('b', 3), row('br', 4)]),
      );
      // The settle wrote nothing into the whole read and left it stale.
      expect(queryClient.getQueryData(wholeKey)).toEqual(
        page([row('a', 1), row('ar', 2)]),
      );
      expect(queryClient.getQueryState(wholeKey)?.isInvalidated).toBe(true);

      // Opening the export again reads the whole thread, B's prompt with it.
      await expect(
        queryClient.fetchQuery(chatWholeMessagesQuery('org1', 't1')),
      ).resolves.toEqual(
        page([row('a', 1), row('ar', 2), row('b', 3), row('br', 4)]),
      );
      expect(backend.reads).toEqual(['', '', '', '']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-reads the newest page when the settle carries no row', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, page([row('m1', 1)]));
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);

    applySettledChatMessage(queryClient, 'org1', 't1', null);
    applySettledChatMessage(queryClient, 'org1', 't1', { id: 'm2' });

    expect(
      invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[2]),
    ).toEqual([
      'chat_message',
      'chat_deferred',
      'chat_message',
      'chat_deferred',
    ]);
    expect(queryClient.getQueryData(key)).toEqual(page([row('m1', 1)]));
  });

  it('reads every page for the whole-thread read, oldest first', async () => {
    const queryClient = new QueryClient();
    const { reads } = stubPages({
      '': page([row('m3', 3)], { order: 3, stepOrder: 0 }),
      '?beforeOrder=3&beforeStep=0': page([row('m2', 2)], {
        order: 2,
        stepOrder: 0,
      }),
      '?beforeOrder=2&beforeStep=0': page([row('m1', 1)]),
    });
    try {
      const whole = await queryClient.fetchQuery(
        chatWholeMessagesQuery('org1', 't1'),
      );

      expect(whole).toEqual(page([row('m1', 1), row('m2', 2), row('m3', 3)]));
      expect(reads).toHaveLength(3);
      // Under the transcript's key: its nudge and its retry reach it.
      expect(chatWholeMessagesQuery('org1', 't1').queryKey.slice(0, 4)).toEqual(
        key,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
