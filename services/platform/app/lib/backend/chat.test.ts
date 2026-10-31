// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { VIDEO_LINK_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { BackendApiError } from './api-client';
import { budgetScopeOf } from './budget-refusal';
import {
  chatPaginatedAdapters,
  sendChatTurn,
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

/** A thread row as `GET /chat/threads` answers it: `null` for every field
 * the row does not carry. */
function wireThread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: null,
    kind: 'direct',
    agentSlug: null,
    harness: null,
    capabilities: null,
    reasoningEffort: null,
    projectId: null,
    sharedWithProject: null,
    archived: false,
    pinnedAt: null,
    lastReplyAt: null,
    lastReadAt: null,
    isShared: null,
    createdAt: 1,
    updatedAt: 2,
    generating: false,
    viewerIsOwner: true,
    ...overrides,
  };
}

function threadPages() {
  const adapter = chatPaginatedAdapters['chat/threads:listThreads'];
  const options = adapter?.({ organizationId: 'org1' }, {});
  if (options === undefined || options === null) {
    throw new Error('the thread list has no paginated row');
  }
  return options;
}

/**
 * The thread list used to come back whole, every active chat in one answer
 * (#5153); it now arrives a keyset page at a time, and the cursor each page
 * answers is what asks for the next.
 */
describe('the paged thread list', () => {
  it('asks for a page of the given size, then passes the cursor on, and maps the rows', async () => {
    // The client asks by path, so the address arrives as a string.
    const fetchMock = vi.fn(async (input: string) =>
      Response.json(
        input.includes('cursor=')
          ? { page: [wireThread('t3')], isDone: true, continueCursor: '' }
          : {
              page: [
                wireThread('t1', { title: 'Pinned', pinnedAt: 9 }),
                wireThread('t2'),
              ],
              isDone: false,
              continueCursor: '2:t2/next',
            },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { queryKey, fetchPage } = threadPages();
      // Under the entity the backend hints, so a write elsewhere refetches it.
      expect(queryKey.slice(0, 3)).toEqual(['backend', 'org1', 'chat_thread']);

      const first = await fetchPage(null, 50);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        '/api/app/chat/threads?limit=50&orgId=org1',
      );
      expect(first).toEqual({
        page: [
          {
            id: 't1',
            kind: 'direct',
            archived: false,
            createdAt: 1,
            updatedAt: 2,
            generating: false,
            viewerIsOwner: true,
            title: 'Pinned',
            pinnedAt: 9,
          },
          {
            id: 't2',
            kind: 'direct',
            archived: false,
            createdAt: 1,
            updatedAt: 2,
            generating: false,
            viewerIsOwner: true,
          },
        ],
        isDone: false,
        continueCursor: '2:t2/next',
      });

      const second = await fetchPage(first.continueCursor, 50);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        `/api/app/chat/threads?limit=50&cursor=${encodeURIComponent('2:t2/next')}&orgId=org1`,
      );
      expect(second).toMatchObject({
        page: [{ id: 't3' }],
        isDone: true,
        continueCursor: '',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads the whole list an older backend answers as one finished page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ threads: [wireThread('t1'), wireThread('t2')] }),
      ),
    );
    try {
      const page = await threadPages().fetchPage(null, 50);
      expect(page.isDone).toBe(true);
      expect(page.continueCursor).toBe('');
      expect(page.page).toMatchObject([{ id: 't1' }, { id: 't2' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
