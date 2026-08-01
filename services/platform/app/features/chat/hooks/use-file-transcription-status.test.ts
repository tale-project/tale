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

const useQueryMock = vi.fn();
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: { file_metadata: { queries: { getByStorageIds: 'getByStorageIds' } } },
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
  } as FileAttachment;
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
  useQueryMock.mockReset();
  useQueryMock.mockReturnValue([]);
});

describe('useFileTranscriptionStatus', () => {
  it('does not subscribe when nothing audio is staged', () => {
    // An images-only compose must not open a metadata subscription, and must
    // never report itself as transcribing.
    const result = run([IMAGE]);

    expect(useQueryMock).toHaveBeenCalledWith('getByStorageIds', 'skip');
    expect(result.isTranscribing).toBe(false);
    expect(result.isQueryLoading).toBe(false);
  });

  it('watches only the audio and video files among the staged set', () => {
    run([IMAGE, AUDIO]);

    expect(useQueryMock).toHaveBeenCalledWith('getByStorageIds', {
      organizationId: ORG,
      storageIds: ['kg2audio'],
    });
  });

  it('blocks pessimistically until the first read answers', () => {
    // `undefined` is "not known yet", not "nothing running" — a fast click in
    // that window would otherwise slip past a `running` row.
    useQueryMock.mockReturnValue(undefined);

    const result = run([AUDIO]);

    expect(result.isQueryLoading).toBe(true);
    expect(result.isTranscribing).toBe(false);
  });

  it.each(['queued', 'running'])('reports %s as still transcribing', (s) => {
    useQueryMock.mockReturnValue([
      { storageId: 'kg2audio', transcriptionStatus: s },
    ]);

    expect(run([AUDIO]).isTranscribing).toBe(true);
  });

  it.each(['completed', 'failed', 'skipped'])(
    'lets a %s row send rather than blocking forever',
    (s) => {
      // Failed and skipped are terminal: the turn injects a marker. Blocking
      // on them would strand the composer with no way forward.
      useQueryMock.mockReturnValue([
        { storageId: 'kg2audio', transcriptionStatus: s },
      ]);

      expect(run([AUDIO]).isTranscribing).toBe(false);
    },
  );

  it('blocks while ANY staged clip is unfinished', () => {
    useQueryMock.mockReturnValue([
      { storageId: 'kg2audio', transcriptionStatus: 'completed' },
      { storageId: 'kg2audio2', transcriptionStatus: 'running' },
    ]);

    expect(
      run([AUDIO, attachment({ fileId: 'kg2audio2' })]).isTranscribing,
    ).toBe(true);
  });

  it('exposes progress and error per file for the chip to render', () => {
    useQueryMock.mockReturnValue([
      {
        storageId: 'kg2audio',
        transcriptionStatus: 'failed',
        transcriptionError: 'Transcription API 500',
        transcriptionProgress: '',
        transcript: undefined,
        transcriptionDurationSec: undefined,
      },
    ]);

    expect(run([AUDIO]).statusMap.get('kg2audio')).toMatchObject({
      status: 'failed',
      error: 'Transcription API 500',
    });
  });
});
