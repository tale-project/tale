/**
 * Orchestration tests for `transcribeAudio` — the attachment-transcription
 * pipeline (read blob → ffmpeg compress → chunk if oversized → per-chunk
 * Whisper → join → ledger).
 *
 * What these lock is the ORDER and the MONEY, not the ffmpeg/HTTP mechanics
 * (`audio_preprocess`, `transcription_request` and `paragraphize` own those):
 *
 *   - nothing is paid for twice — the single-flight lock, the content-hash
 *     dedup, and the cancellation pre-check each short-circuit BEFORE
 *     compression and before any provider call;
 *   - a row never ends up stuck — callers schedule this fire-and-forget, so
 *     every exit writes a terminal status and releases the lease, including
 *     the paths that throw;
 *   - a transient failure retries with backoff while a permanent one fails
 *     fast, so a bad key doesn't burn three provider calls;
 *   - temp files are always cleaned up, and secrets never reach the
 *     user-visible `transcriptionError`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — registered before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
      bytes: stub,
    },
    ConvexError: class ConvexError extends Error {
      data: unknown;
      constructor(data: unknown) {
        super(typeof data === 'string' ? data : 'ConvexError');
        this.data = data;
      }
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, internalAction: vi.fn((config) => config) };
});

// Token strings stand in for function references so assertions read as the
// call they represent.
vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_queries: {
        getByStorageId: 'getByStorageId',
        getStorageSha256: 'getStorageSha256',
        findCachedTranscript: 'findCachedTranscript',
      },
      internal_mutations: {
        updateFileTranscription: 'updateFileTranscription',
        acquireTranscriptionLock: 'acquireTranscriptionLock',
        releaseTranscriptionLock: 'releaseTranscriptionLock',
      },
      transcribe_audio: { transcribeAudio: 'transcribeAudio' },
    },
    governance: {
      internal_mutations: {
        recordTranscriptionUsage: 'recordTranscriptionUsage',
      },
    },
    video_links: {
      internal_mutations: {
        heartbeatJobByStorageId: 'heartbeatJobByStorageId',
      },
    },
  },
}));

const mockCompressAudio = vi.fn();
const mockChunkCompressedAudio = vi.fn();
vi.mock('./audio_preprocess', () => ({
  compressAudio: (...args: unknown[]) => mockCompressAudio(...args),
  chunkCompressedAudio: (...args: unknown[]) =>
    mockChunkCompressedAudio(...args),
  // 24 MiB in production; kept identical so the trigger arithmetic under test
  // is the real one.
  CHUNK_TRIGGER_BYTES: 24 * 1024 * 1024,
}));

const mockRequestTranscription = vi.fn();
vi.mock('./transcription_request', () => ({
  requestTranscription: (...args: unknown[]) =>
    mockRequestTranscription(...args),
}));

const mockResolveModel = vi.fn();
vi.mock('../lib/providers/resolve_transcription_model', () => ({
  resolveTranscriptionModel: (...args: unknown[]) => mockResolveModel(...args),
}));

const mockCheckHostPolicy = vi.fn();
vi.mock('../lib/http/host_policy', () => ({
  checkProviderHostPolicy: (...args: unknown[]) => mockCheckHostPolicy(...args),
}));

const mockReadBlobBytes = vi.fn();
vi.mock('../lib/storage/blob_access', () => ({
  readBlobBytes: (...args: unknown[]) => mockReadBlobBytes(...args),
}));

const mockOrgSlug = vi.fn();
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: (...args: unknown[]) => mockOrgSlug(...args),
}));

vi.mock('../governance/cost_estimation', () => ({
  estimateTranscriptionCostCents: () => 0,
}));

vi.mock('../../lib/shared/constants/usage', () => ({
  TRANSCRIPTION_SLUG: '__transcription__',
}));

// `paragraphize` is pure and cheap — exercise the real joiner so the stored
// transcript in these assertions is the one users would read.

const { transcribeAudio } = await import('./transcribe_audio');

interface HandlerArgs {
  storageId: string;
  fileName: string;
  contentType: string;
  organizationId: string;
  attempt?: number;
}

const handler = (
  transcribeAudio as unknown as {
    handler: (ctx: unknown, args: HandlerArgs) => Promise<null>;
  }
).handler;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ORG_ID = 'org_test';
const STORAGE_ID = 'kg2abcdefghijklmnop';
const MODEL = {
  modelId: 'whisper-1',
  providerName: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
};

/** The `fileMetadata` row the pre-check, source gate and ledger step read. */
let row: Record<string, unknown> | null;
/** `_storage` SHA-256 — null disables dedup (an `s3:` ref has no system row). */
let sha256: string | null;
/** A prior row with the same content hash, or null for a dedup miss. */
let cached: Record<string, unknown> | null;

const compressCleanup = vi.fn();
const chunkCleanup = vi.fn();

function jobArgs(overrides: Partial<HandlerArgs> = {}): HandlerArgs {
  return {
    storageId: STORAGE_ID,
    fileName: 'standup.m4a',
    contentType: 'audio/m4a',
    organizationId: ORG_ID,
    ...overrides,
  };
}

interface MockCtx {
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
  scheduler: { runAfter: ReturnType<typeof vi.fn> };
  storage: { get: ReturnType<typeof vi.fn> };
}

/** Grants the lease by echoing the caller's runId — what the real mutation
 * does when no other invocation holds it. */
function grantLock(callArgs: { runId: string }): string {
  return callArgs.runId;
}

let lockResponse: (callArgs: { runId: string }) => string | null;

function createMockCtx(): MockCtx {
  return {
    runQuery: vi.fn(async (token: string) => {
      switch (token) {
        case 'getByStorageId':
          return row;
        case 'getStorageSha256':
          return sha256;
        case 'findCachedTranscript':
          return cached;
        default:
          throw new Error(`unexpected query: ${token}`);
      }
    }),
    runMutation: vi.fn(async (token: string, callArgs: { runId: string }) => {
      if (token === 'acquireTranscriptionLock') return lockResponse(callArgs);
      return null;
    }),
    scheduler: { runAfter: vi.fn().mockResolvedValue('job_1') },
    storage: { get: vi.fn().mockResolvedValue(new Blob(['raw audio'])) },
  };
}

/** Every `updateFileTranscription` payload, in call order. */
function transcriptionWrites(ctx: MockCtx): Record<string, unknown>[] {
  return ctx.runMutation.mock.calls
    .filter(([token]) => token === 'updateFileTranscription')
    .map(([, payload]) => payload as Record<string, unknown>);
}

/** The payload that carried a terminal status, if any. */
function terminalWrite(ctx: MockCtx): Record<string, unknown> | undefined {
  return transcriptionWrites(ctx)
    .toReversed()
    .find(
      (w) =>
        w.transcriptionStatus === 'completed' ||
        w.transcriptionStatus === 'failed',
    );
}

function calledWith(ctx: MockCtx, token: string): boolean {
  return ctx.runMutation.mock.calls.some(([called]) => called === token);
}

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    _id: 'fm_1',
    storageId: STORAGE_ID,
    transcriptionStatus: 'queued',
    uploadedBy: 'user_123',
    source: 'upload',
  };
  sha256 = null;
  cached = null;
  lockResponse = grantLock;
  mockResolveModel.mockResolvedValue(MODEL);
  mockCheckHostPolicy.mockImplementation((url: string) => new URL(url));
  mockOrgSlug.mockResolvedValue('acme');
  mockCompressAudio.mockResolvedValue({
    blob: new Blob(['compressed opus']),
    durationSec: 42,
    sizeBytes: 1_000_000,
    cleanup: compressCleanup,
  });
  mockChunkCompressedAudio.mockResolvedValue({
    chunks: [
      { blob: new Blob(['c0']), durationSec: 5400, index: 0 },
      { blob: new Blob(['c1']), durationSec: 1200, index: 1 },
    ],
    cleanup: chunkCleanup,
  });
  mockRequestTranscription.mockResolvedValue({
    text: 'we shipped the thing',
    duration: 42,
    segments: [{ start: 0, end: 3, text: 'we shipped the thing' }],
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transcribeAudio — short circuits before spending money', () => {
  it.each([
    ['skipped', 'skipped'],
    ['failed', 'failed'],
  ])(
    'does no work when the row is already %s (user removed the attachment)',
    async (status) => {
      row = { ...row, transcriptionStatus: status };
      const ctx = createMockCtx();

      await handler(ctx, jobArgs());

      // The lease is never taken, so nothing has to release it either.
      expect(calledWith(ctx, 'acquireTranscriptionLock')).toBe(false);
      expect(mockCompressAudio).not.toHaveBeenCalled();
      expect(mockRequestTranscription).not.toHaveBeenCalled();
    },
  );

  it('does no work when the row is gone', async () => {
    row = null;
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(calledWith(ctx, 'acquireTranscriptionLock')).toBe(false);
    expect(mockCompressAudio).not.toHaveBeenCalled();
  });

  it('returns without work when another invocation holds the lease', async () => {
    // A retry double-click used to let both callers through: double provider
    // bill, double `+=` ledger write.
    lockResponse = () => null;
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(mockCompressAudio).not.toHaveBeenCalled();
    expect(mockRequestTranscription).not.toHaveBeenCalled();
    // Must NOT release a lease it never won — that would free the winner's.
    expect(calledWith(ctx, 'releaseTranscriptionLock')).toBe(false);
  });

  it('copies a prior transcript for identical content instead of re-paying', async () => {
    sha256 = 'hash_abc';
    cached = {
      storageId: 'kg2otherfileref',
      transcript: 'previously transcribed words',
      transcriptionDurationSec: 99,
    };
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(mockCompressAudio).not.toHaveBeenCalled();
    expect(mockRequestTranscription).not.toHaveBeenCalled();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'completed',
      transcript: 'previously transcribed words',
      transcriptionDurationSec: 99,
    });
    // No provider call happened, so nothing may hit the usage ledger.
    expect(calledWith(ctx, 'recordTranscriptionUsage')).toBe(false);
    // The lease is still released — a dedup hit must not park the row.
    expect(calledWith(ctx, 'releaseTranscriptionLock')).toBe(true);
  });

  it('stores the content hash so the NEXT identical upload can dedup', async () => {
    sha256 = 'hash_abc';
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(transcriptionWrites(ctx)).toContainEqual(
      expect.objectContaining({ contentHash: 'hash_abc' }),
    );
  });
});

describe('transcribeAudio — the transcribing path', () => {
  it('compresses once, transcribes, and stores transcript + duration', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(mockCompressAudio).toHaveBeenCalledOnce();
    // Under the chunk trigger, so the compressed blob goes out whole.
    expect(mockChunkCompressedAudio).not.toHaveBeenCalled();
    expect(mockRequestTranscription).toHaveBeenCalledOnce();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'completed',
      transcript: 'we shipped the thing',
      transcriptionDurationSec: 42,
      // Cleared so the chip stops showing a stale step.
      transcriptionProgress: '',
    });
  });

  it('re-checks host policy on the resolved base URL before the request', async () => {
    // Defense-in-depth: a provider file edited to point at an internal host
    // must not receive the bearer token.
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(mockCheckHostPolicy).toHaveBeenCalledWith(
      'https://api.example.com/v1',
    );
  });

  it('sends a `.ogg` filename — Whisper validates by extension', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(mockRequestTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'standup.m4a.ogg', format: 'ogg' }),
    );
  });

  it('records audio minutes against the uploader', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'recordTranscriptionUsage',
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: 'user_123',
        agentSlug: '__transcription__',
        model: 'whisper-1',
        provider: 'openai',
        audioDurationSec: 42,
      }),
    );
  });

  it('skips the ledger when the row has no uploader to bill', async () => {
    row = { ...row, uploadedBy: undefined };
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(calledWith(ctx, 'recordTranscriptionUsage')).toBe(false);
    // The transcript still lands — usage accounting is not a gate on it.
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'completed',
    });
  });

  it('adds [HH:MM:SS] prefixes only for video-link sources', async () => {
    // Timestamps let an agent cite "at 12:34…" in a video summary; on a plain
    // voice memo they would just be noise in every paragraph.
    const plain = createMockCtx();
    await handler(plain, jobArgs());
    expect(terminalWrite(plain)?.transcript).toBe('we shipped the thing');

    vi.clearAllMocks();
    mockResolveModel.mockResolvedValue(MODEL);
    mockCheckHostPolicy.mockImplementation((url: string) => new URL(url));
    mockCompressAudio.mockResolvedValue({
      blob: new Blob(['compressed opus']),
      durationSec: 42,
      sizeBytes: 1_000_000,
      cleanup: compressCleanup,
    });
    mockRequestTranscription.mockResolvedValue({
      text: 'we shipped the thing',
      duration: 42,
      segments: [{ start: 0, end: 3, text: 'we shipped the thing' }],
    });
    row = { ...row, source: 'video_link' };
    const video = createMockCtx();

    await handler(video, jobArgs());

    expect(terminalWrite(video)?.transcript).toBe(
      '[00:00:00] we shipped the thing',
    );
  });

  it('heartbeats the owning video-link job so its watchdog does not kill it', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'heartbeatJobByStorageId',
      expect.objectContaining({ storageId: STORAGE_ID }),
    );
  });

  it('always cleans up the compressed temp file', async () => {
    await handler(createMockCtx(), jobArgs());
    expect(compressCleanup).toHaveBeenCalledOnce();
  });

  it('releases the lease on the happy path', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'releaseTranscriptionLock',
      expect.objectContaining({ storageId: STORAGE_ID }),
    );
  });
});

describe('transcribeAudio — oversized audio', () => {
  beforeEach(() => {
    // One byte over OpenAI's limit-minus-margin is enough to force the split.
    mockCompressAudio.mockResolvedValue({
      blob: new Blob(['big compressed opus']),
      durationSec: 6600,
      sizeBytes: 24 * 1024 * 1024 + 1,
      cleanup: compressCleanup,
    });
  });

  it('splits, transcribes every chunk, and joins the parts', async () => {
    mockRequestTranscription
      .mockResolvedValueOnce({
        text: 'first ninety minutes',
        duration: 5400,
        segments: [{ start: 0, end: 10, text: 'first ninety minutes' }],
      })
      .mockResolvedValueOnce({
        text: 'the tail',
        duration: 1200,
        segments: [{ start: 0, end: 5, text: 'the tail' }],
      });
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(mockChunkCompressedAudio).toHaveBeenCalledOnce();
    expect(mockRequestTranscription).toHaveBeenCalledTimes(2);
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'completed',
      transcript: 'first ninety minutes\n\nthe tail',
      // Summed across chunks, not just the last one's.
      transcriptionDurationSec: 6600,
    });
  });

  it('names later chunks distinctly and cleans up every chunk file', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    const names = mockRequestTranscription.mock.calls.map(
      (call) => (call[0] as { fileName: string }).fileName,
    );
    expect(names).toEqual(['standup.m4a.ogg', 'standup.m4a.chunk-1.ogg']);
    expect(chunkCleanup).toHaveBeenCalledOnce();
    expect(compressCleanup).toHaveBeenCalledOnce();
  });

  it('reports which chunk is in flight so the chip can show progress', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    const progress = transcriptionWrites(ctx)
      .map((w) => w.transcriptionProgress)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    expect(progress).toContain('transcribing chunk 1 of 2');
    expect(progress).toContain('transcribing chunk 2 of 2');
  });

  it('fails when compression yields nothing rather than storing an empty transcript', async () => {
    mockChunkCompressedAudio.mockResolvedValue({
      chunks: [],
      cleanup: chunkCleanup,
    });
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(mockRequestTranscription).not.toHaveBeenCalled();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'failed',
      transcriptionError: expect.stringContaining('no output audio'),
    });
  });
});

describe('transcribeAudio — blob backends', () => {
  it('reads a Convex `_storage` blob through ctx.storage', async () => {
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(ctx.storage.get).toHaveBeenCalledWith(STORAGE_ID);
    expect(mockReadBlobBytes).not.toHaveBeenCalled();
  });

  it("reads an `s3:` blob from the org's own bucket", async () => {
    mockReadBlobBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ storageId: 's3:acme/clip-uuid' }));

    expect(mockReadBlobBytes).toHaveBeenCalledWith(
      ctx,
      'acme',
      's3:acme/clip-uuid',
    );
    expect(ctx.storage.get).not.toHaveBeenCalled();
    // No `_storage` system row exists for an s3 ref, so dedup is off rather
    // than wrong.
    expect(ctx.runQuery).not.toHaveBeenCalledWith(
      'getStorageSha256',
      expect.anything(),
    );
  });

  it('fails loudly when an `s3:` blob has no resolvable org', async () => {
    mockOrgSlug.mockResolvedValue(null);
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ storageId: 's3:acme/clip-uuid', attempt: 3 }));

    expect(mockRequestTranscription).not.toHaveBeenCalled();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'failed',
      transcriptionError: expect.stringContaining('unresolvable'),
    });
  });

  it('fails when the blob is missing from storage', async () => {
    const ctx = createMockCtx();
    ctx.storage.get.mockResolvedValue(null);

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'failed',
      transcriptionError: expect.stringContaining('not found in storage'),
    });
  });
});

describe('transcribeAudio — failure handling', () => {
  it('re-queues with backoff on a transient upstream failure', async () => {
    mockRequestTranscription.mockRejectedValue(
      Object.assign(new Error('Transcription API 429: slow down'), {
        status: 429,
      }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    // Back to `queued`, NOT `failed` — the chip must not offer a retry for
    // something already being retried.
    expect(transcriptionWrites(ctx)).toContainEqual(
      expect.objectContaining({ transcriptionStatus: 'queued' }),
    );
    expect(terminalWrite(ctx)).toBeUndefined();
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      30_000,
      'transcribeAudio',
      expect.objectContaining({ attempt: 1 }),
    );
    // The lease is freed so the rescheduled run can take it.
    expect(calledWith(ctx, 'releaseTranscriptionLock')).toBe(true);
  });

  it('lengthens the backoff on each further attempt', async () => {
    mockRequestTranscription.mockRejectedValue(
      Object.assign(new Error('upstream exploded'), { status: 503 }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 1 }));

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      60_000,
      'transcribeAudio',
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it('gives up after the last attempt instead of rescheduling forever', async () => {
    mockRequestTranscription.mockRejectedValue(
      Object.assign(new Error('still rate limited'), { status: 429 }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'failed',
      transcriptionProgress: '',
    });
  });

  it('fails fast on a permanent failure rather than retrying a bad key', async () => {
    mockRequestTranscription.mockRejectedValue(
      Object.assign(new Error('Transcription API 401: invalid key'), {
        status: 401,
      }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'failed',
    });
  });

  it('fails fast when the org has no transcription model configured', async () => {
    // An admin has to act; retrying three times just delays the message.
    mockResolveModel.mockRejectedValue(
      Object.assign(new Error('No transcription model'), {
        data: { code: 'NO_TRANSCRIPTION_MODEL' },
      }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(terminalWrite(ctx)).toMatchObject({
      transcriptionStatus: 'failed',
    });
  });

  it('stores a ConvexError payload as prose, not as raw JSON', async () => {
    // `transcriptionError` is read by a person. A ConvexError stringifies its
    // whole payload into `.message`, which put
    // `{"code":"NO_TRANSCRIPTION_MODEL","message":"…"}` on the row verbatim.
    mockResolveModel.mockRejectedValue(
      Object.assign(
        new Error(
          '{"code":"NO_TRANSCRIPTION_MODEL","message":"No transcription model is configured for this organization."}',
        ),
        {
          data: {
            code: 'NO_TRANSCRIPTION_MODEL',
            message:
              'No transcription model is configured for this organization.',
          },
        },
      ),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(terminalWrite(ctx)?.transcriptionError).toBe(
      'No transcription model is configured for this organization.',
    );
  });

  it('still reads a plain Error message when there is no payload', async () => {
    mockRequestTranscription.mockRejectedValue(new Error('ffmpeg exploded'));
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(terminalWrite(ctx)?.transcriptionError).toBe('ffmpeg exploded');
  });

  it("keeps a transport failure's cause, which is the whole diagnosis", async () => {
    // undici reports EVERY transport failure as the bare string `fetch
    // failed`; the reason lives on `cause`. A row saying only "fetch failed"
    // cannot distinguish bad DNS from blocked egress from a dead endpoint.
    mockRequestTranscription.mockRejectedValue(
      new Error('fetch failed', {
        cause: Object.assign(
          new Error('getaddrinfo ENOTFOUND api.example.com'),
          {
            code: 'ENOTFOUND',
          },
        ),
      }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    const stored = String(terminalWrite(ctx)?.transcriptionError);
    expect(stored).toContain('fetch failed');
    expect(stored).toContain('ENOTFOUND');
  });

  it('does not repeat a cause the message already states', async () => {
    mockRequestTranscription.mockRejectedValue(
      new Error('connection refused', {
        cause: new Error('connection refused'),
      }),
    );
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(terminalWrite(ctx)?.transcriptionError).toBe('connection refused');
  });

  it('never writes a failure the user already cancelled', async () => {
    // Removing the attachment sets `skipped`; a late error must not resurrect
    // the row as a failure the user then sees a retry chip for.
    mockRequestTranscription.mockImplementation(() => {
      row = { ...row, transcriptionStatus: 'skipped' };
      throw new Error('fetch failed');
    });
    const ctx = createMockCtx();

    await handler(ctx, jobArgs());

    expect(terminalWrite(ctx)).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  // `transcriptionError` is rendered to the user, so a provider that echoes
  // the credential back in its message must not leak it onto the row. One
  // case per redaction rule — a single message matching several rules would
  // still pass with all but one of them broken.
  it.each([
    ['a bearer header', 'upstream said: Bearer ghp_A1b2C3d4E5f6 is invalid'],
    ['an OpenAI-style key', 'auth failed for sk-live-abc123def456'],
    ['an Authorization header dump', 'sent Authorization: Basic dXNlcjpwYXNz'],
  ])('scrubs %s out of the stored error', async (_label, message) => {
    mockRequestTranscription.mockRejectedValue(new Error(message));
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    const stored = String(terminalWrite(ctx)?.transcriptionError);
    expect(stored).toContain('REDACTED');
    for (const secret of [
      'ghp_A1b2C3d4E5f6',
      'sk-live-abc123def456',
      'dXNlcjpwYXNz',
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it('bounds a runaway upstream message instead of storing all of it', async () => {
    mockRequestTranscription.mockRejectedValue(new Error('x'.repeat(5_000)));
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(String(terminalWrite(ctx)?.transcriptionError).length).toBe(500);
  });

  it('cleans up temp files and the lease even when the request throws', async () => {
    mockRequestTranscription.mockRejectedValue(new Error('boom'));
    const ctx = createMockCtx();

    await handler(ctx, jobArgs({ attempt: 3 }));

    expect(compressCleanup).toHaveBeenCalledOnce();
    expect(calledWith(ctx, 'releaseTranscriptionLock')).toBe(true);
  });
});
