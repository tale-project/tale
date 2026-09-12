// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { VIDEO_LINK_HINT_ENTITY } from '@/lib/shared/hint-entities';

import {
  videoJobsForThreadQuery,
  videoJobsPollInterval,
  videoJobsUnboundQuery,
} from './chat';

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
