// @vitest-environment node

/**
 * An uploaded recording's transcription is held against the uploader's
 * limits before the provider hears it, refused (and never retried) when a
 * limit has too little room, and booked at the minutes it transcribed — a
 * failed attempt's finished chunks included — without a booking failure
 * ever sending a finished transcript round again. Compression, the provider
 * wire and the ctx are stand-ins; the job is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const mocks = vi.hoisted(() => ({
  compressAudio: vi.fn(),
  chunkCompressedAudio: vi.fn(),
  requestTranscription: vi.fn(),
}));

vi.mock('./audio_preprocess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audio_preprocess')>()),
  compressAudio: mocks.compressAudio,
  chunkCompressedAudio: mocks.chunkCompressedAudio,
}));
vi.mock('./transcription_request', () => ({
  requestTranscription: mocks.requestTranscription,
}));
vi.mock('../lib/providers/resolve_transcription_model', () => ({
  resolveTranscriptionModel: vi.fn(async () => ({
    modelId: 'whisper-1',
    providerName: 'openai',
    baseUrl: 'https://api.openai.example/v1',
    apiKey: 'sk-test',
    centsPerAudioMinute: 0.6,
  })),
}));
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: vi.fn(async () => 'org-slug'),
}));
vi.mock('../lib/storage/blob_access', () => ({
  readBlobBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('../../../lib/net/host-policy', () => ({
  checkProviderHostPolicy: vi.fn(),
}));

const { transcribeAudioImpl } = await import('./transcribe_audio');

const LEASE = { sessionId: 'direct-call:transcription', execId: 'e1' };
const ARGS = {
  storageId: 's3:org/recording',
  fileName: 'meeting.m4a',
  contentType: 'audio/mp4',
  organizationId: 'org-1',
};

let admission: unknown;
const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
const scheduled: unknown[] = [];

function fakeCtx(
  options: {
    settleFails?: boolean;
    /** The row's status as each read finds it, in order; `queued` after. */
    statuses?: (string | null)[];
  } = {},
) {
  const statuses = [...(options.statuses ?? [])];
  return {
    runQuery: vi.fn(async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'file_metadata/internal_queries:getByStorageId') {
        const status = statuses.length > 0 ? statuses.shift() : 'queued';
        return status === null
          ? null
          : { transcriptionStatus: status, uploadedBy: 'user-1' };
      }
      return null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name.endsWith(':acquireTranscriptionLock')) return args.runId;
      if (name.endsWith(':openTranscriptionCall')) return admission;
      if (name.endsWith(':settleTranscriptionCall') && options.settleFails) {
        throw new Error('ledger down');
      }
      return null;
    }),
    scheduler: {
      runAfter: vi.fn(async (_delay: number, _ref: unknown, args: unknown) => {
        scheduled.push(args);
      }),
    },
  };
}

const called = (suffix: string) =>
  mutations.filter((mutation) => mutation.name.endsWith(suffix));

function compressedTo(durationSec: number, sizeBytes = 1_000) {
  mocks.compressAudio.mockResolvedValue({
    blob: new Blob([new Uint8Array(4)]),
    durationSec,
    sizeBytes,
    cleanup: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mutations.length = 0;
  scheduled.length = 0;
  admission = { allowed: true, lease: LEASE };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  compressedTo(90);
  mocks.requestTranscription.mockResolvedValue({
    text: 'Hello there.',
    segments: [],
    duration: 88,
  });
});

describe('transcribeAudioImpl and the uploader’s limits', () => {
  it('holds the recording’s length before the provider, and books the minutes it transcribed [GOV-R5]', async () => {
    await transcribeAudioImpl(fakeCtx() as never, ARGS);

    expect(called(':openTranscriptionCall')).toEqual([
      {
        name: 'file_metadata/internal_mutations:openTranscriptionCall',
        args: {
          organizationId: 'org-1',
          provider: 'openai',
          model: 'whisper-1',
          centsPerAudioMinute: 0.6,
          storageId: 's3:org/recording',
          audioDurationSec: 90,
        },
      },
    ]);
    expect(called(':settleTranscriptionCall')[0]?.args).toEqual({
      organizationId: 'org-1',
      provider: 'openai',
      model: 'whisper-1',
      centsPerAudioMinute: 0.6,
      lease: LEASE,
      audioDurationSec: 88,
    });
    expect(called(':releaseTranscriptionCall')).toEqual([]);
    expect(
      called(':updateFileTranscription').some(
        (mutation) => mutation.args.transcriptionStatus === 'completed',
      ),
    ).toBe(true);
  });

  it('fails a recording a limit refuses before the provider hears it, and never retries it [GOV-R4]', async () => {
    admission = {
      allowed: false,
      reason:
        'Usage limit reached. Your monthly cost limit is used up until 2026-11-01T00:00:00.000Z.',
    };

    await transcribeAudioImpl(fakeCtx() as never, ARGS);

    expect(mocks.requestTranscription).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
    const failed = called(':updateFileTranscription').find(
      (mutation) => mutation.args.transcriptionStatus === 'failed',
    );
    expect(failed?.args.transcriptionError).toContain(
      'Your monthly cost limit is used up',
    );
  });

  it('books the chunks a failed attempt finished, and retries holding afresh', async () => {
    compressedTo(120, Number.MAX_SAFE_INTEGER);
    mocks.chunkCompressedAudio.mockResolvedValue({
      chunks: [
        { blob: new Blob([new Uint8Array(2)]), durationSec: 60, index: 0 },
        { blob: new Blob([new Uint8Array(2)]), durationSec: 60, index: 1 },
      ],
      cleanup: vi.fn(async () => undefined),
    });
    mocks.requestTranscription
      .mockResolvedValueOnce({ text: 'One.', segments: [], duration: 60 })
      .mockRejectedValueOnce(
        Object.assign(new Error('upstream 503'), { status: 503 }),
      );

    await transcribeAudioImpl(fakeCtx() as never, ARGS);

    expect(called(':settleTranscriptionCall')[0]?.args).toMatchObject({
      lease: LEASE,
      audioDurationSec: 60,
    });
    expect(scheduled).toHaveLength(1);
  });

  it('releases the hold of an attempt that transcribed nothing', async () => {
    mocks.requestTranscription.mockRejectedValueOnce(
      Object.assign(new Error('bad audio'), { status: 400 }),
    );

    await transcribeAudioImpl(fakeCtx() as never, ARGS);

    expect(called(':settleTranscriptionCall')).toEqual([]);
    expect(called(':releaseTranscriptionCall')).toEqual([
      {
        name: 'file_metadata/internal_mutations:releaseTranscriptionCall',
        args: { lease: LEASE },
      },
    ]);
  });

  it('never sends a finished transcript round again because its booking failed', async () => {
    await transcribeAudioImpl(fakeCtx({ settleFails: true }) as never, ARGS);

    expect(mocks.requestTranscription).toHaveBeenCalledTimes(1);
    expect(scheduled).toEqual([]);
    expect(
      called(':updateFileTranscription').some(
        (mutation) => mutation.args.transcriptionStatus === 'failed',
      ),
    ).toBe(false);
  });

  it('reports nothing for a recording removed before its hold', async () => {
    admission = {
      allowed: false,
      cancelled: true,
      reason: 'The recording was removed before its transcription could start.',
    };

    await transcribeAudioImpl(fakeCtx() as never, ARGS);

    expect(mocks.requestTranscription).not.toHaveBeenCalled();
    expect(
      called(':updateFileTranscription').some(
        (mutation) => mutation.args.transcriptionStatus === 'failed',
      ),
    ).toBe(false);
    expect(scheduled).toEqual([]);
  });

  it('stops at a removal mid-way, booking the chunks already transcribed', async () => {
    compressedTo(120, Number.MAX_SAFE_INTEGER);
    mocks.chunkCompressedAudio.mockResolvedValue({
      chunks: [
        { blob: new Blob([new Uint8Array(2)]), durationSec: 60, index: 0 },
        { blob: new Blob([new Uint8Array(2)]), durationSec: 60, index: 1 },
      ],
      cleanup: vi.fn(async () => undefined),
    });
    mocks.requestTranscription.mockResolvedValueOnce({
      text: 'One.',
      segments: [],
      duration: 60,
    });

    // The pre-check finds it queued; before chunk 2 it reads `skipped`.
    await transcribeAudioImpl(
      fakeCtx({ statuses: ['queued', 'skipped'] }) as never,
      ARGS,
    );

    expect(mocks.requestTranscription).toHaveBeenCalledTimes(1);
    expect(called(':settleTranscriptionCall')[0]?.args).toMatchObject({
      audioDurationSec: 60,
    });
    expect(
      called(':updateFileTranscription').some(
        (mutation) => mutation.args.transcriptionStatus === 'completed',
      ),
    ).toBe(false);
  });

  it('tells a video link that handed its audio over that a usage limit refused it', async () => {
    admission = {
      allowed: false,
      reason: 'Usage limit reached. Your monthly cost limit is used up.',
    };

    await transcribeAudioImpl(fakeCtx() as never, ARGS);

    const failed = called(':updateFileTranscription').find(
      (mutation) => mutation.args.transcriptionStatus === 'failed',
    );
    expect(failed?.args.transcriptionErrorCode).toBe('budgetExceeded');
  });
});
