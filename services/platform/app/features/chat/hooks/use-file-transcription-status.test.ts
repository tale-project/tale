// @vitest-environment jsdom
/**
 * The hook that decides the composer's send gate for staged audio/video.
 *
 * The gate itself is asserted in `chat-surface.test.tsx`; what matters here is
 * the input side of it — which staged files are watched at all, and when
 * "still transcribing" is true. Getting `isTranscribing` wrong in the lenient
 * direction lets a send beat its transcript and reach the model with a "could
 * not be transcribed" marker instead of the words the user attached.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileAttachment } from '@/app/features/shared/files/types';

// The read is HTTP now: the mock records the react-query options (enabled
// + key) and serves the seeded rows as `data`.
const useQueryMock = vi.fn(
  (_options: { queryKey?: unknown[]; enabled?: boolean }) =>
    ({ data: undefined }) as { data: unknown },
);
const seeded: { rows: unknown } = { rows: [] };
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey?: unknown[]; enabled?: boolean }) => {
    useQueryMock(options);
    return { data: options.enabled === false ? undefined : seeded.rows };
  },
}));

const { useFileTranscriptionStatus } =
  await import('./use-file-transcription-status');

const ORG = 'org-1';

function attachment(overrides: Partial<FileAttachment>): FileAttachment {
  return {
    fileId: 'kg2audio',
    fileName: 'standup.m4a',
    fileType: 'audio/m4a',
    fileSize: 1024,
    ...overrides,
  };
}

const AUDIO = attachment({});
const IMAGE = attachment({
  fileId: 'kg2image',
  fileName: 'shot.png',
  fileType: 'image/png',
});

function run(attachments: readonly FileAttachment[]) {
  return renderHook(() => useFileTranscriptionStatus(attachments, ORG)).result
    .current;
}

beforeEach(() => {
  useQueryMock.mockClear();
  seeded.rows = [];
});

describe('useFileTranscriptionStatus', () => {
  it('does not subscribe when nothing audio is staged', () => {
    // An images-only compose must not open a metadata subscription, and must
    // never report itself as transcribing.
    const result = run([IMAGE]);

    expect(useQueryMock.mock.calls[0]?.[0]?.enabled).toBe(false);
    expect(result.isTranscribing).toBe(false);
    expect(result.isQueryLoading).toBe(false);
  });

  it('watches only the audio and video files among the staged set', () => {
    run([IMAGE, AUDIO]);

    const options = useQueryMock.mock.calls[0]?.[0];
    expect(options?.enabled).toBe(true);
    expect(JSON.stringify(options?.queryKey)).toContain(AUDIO.fileId);
    expect(JSON.stringify(options?.queryKey)).not.toContain(IMAGE.fileId);
  });

  it('blocks pessimistically until the first read answers', () => {
    // `undefined` is "not known yet", not "nothing running" — a fast click in
    // that window would otherwise slip past a `running` row.
    seeded.rows = undefined;

    const result = run([AUDIO]);

    expect(result.isQueryLoading).toBe(true);
    expect(result.isTranscribing).toBe(false);
  });

  it.each(['queued', 'running'])('reports %s as still transcribing', (s) => {
    seeded.rows = [{ storageId: 'kg2audio', transcriptionStatus: s }];

    expect(run([AUDIO]).isTranscribing).toBe(true);
  });

  it.each(['completed', 'failed', 'skipped'])(
    'lets a %s row send rather than blocking forever',
    (s) => {
      // Failed and skipped are terminal: the turn injects a marker. Blocking
      // on them would strand the composer with no way forward.
      seeded.rows = [{ storageId: 'kg2audio', transcriptionStatus: s }];

      expect(run([AUDIO]).isTranscribing).toBe(false);
    },
  );

  it('blocks while ANY staged clip is unfinished', () => {
    seeded.rows = [
      { storageId: 'kg2audio', transcriptionStatus: 'completed' },
      { storageId: 'kg2audio2', transcriptionStatus: 'running' },
    ];

    expect(
      run([AUDIO, attachment({ fileId: 'kg2audio2' })]).isTranscribing,
    ).toBe(true);
  });

  it('exposes progress and error per file for the chip to render', () => {
    seeded.rows = [
      {
        storageId: 'kg2audio',
        transcriptionStatus: 'failed',
        transcriptionError: 'Transcription API 500',
        transcriptionProgress: '',
        transcript: undefined,
        transcriptionDurationSec: undefined,
      },
    ];

    expect(run([AUDIO]).statusMap.get('kg2audio')).toMatchObject({
      status: 'failed',
      error: 'Transcription API 500',
    });
  });
});
