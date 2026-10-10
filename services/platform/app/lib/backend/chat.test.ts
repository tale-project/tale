// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { VIDEO_LINK_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { BackendApiError } from './api-client';
import { budgetScopeOf } from './budget-refusal';
import {
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
