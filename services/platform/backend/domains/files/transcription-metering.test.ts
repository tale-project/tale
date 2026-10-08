/**
 * A transcription is a direct call billed by the audio minute: held at the
 * recording's whole length, booked at what the provider transcribed, under
 * the uploader (and the chat's project) — or, for a dictation, the member
 * dictating. The direct-call lease, the thread lookup, the provider wire
 * and the clip probe are stand-ins.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';

const mocks = vi.hoisted(() => ({
  openDirectCall: vi.fn(),
  settleDirectCall: vi.fn(async () => 'settled'),
  releaseDirectCall: vi.fn(async () => undefined),
  probeAudioDurationSec: vi.fn(async () => 12),
  requestTranscription: vi.fn(),
}));

vi.mock('../governance/direct-calls.ts', () => ({
  openDirectCall: mocks.openDirectCall,
  settleDirectCall: mocks.settleDirectCall,
  releaseDirectCall: mocks.releaseDirectCall,
}));
vi.mock(
  '../../core/file_metadata/audio_preprocess.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../core/file_metadata/audio_preprocess.ts')
    >()),
    probeAudioDurationSec: mocks.probeAudioDurationSec,
  }),
);
vi.mock('../../core/file_metadata/transcription_request.ts', () => ({
  requestTranscription: mocks.requestTranscription,
}));
vi.mock('../../core/lib/providers/resolve_transcription_model.ts', () => ({
  resolveTranscriptionModel: vi.fn(async () => ({
    modelId: 'whisper-1',
    providerName: 'openai',
    baseUrl: 'https://api.openai.example/v1',
    apiKey: 'sk-test',
    centsPerAudioMinute: 0.6,
  })),
}));
vi.mock('../../../lib/net/host-policy.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/host-policy.ts')>()),
  checkProviderHostPolicy: vi.fn(),
}));

const {
  openTranscriptionCall,
  settleTranscriptionCall,
  uploadTranscriptionSubject,
} = await import('./transcription-metering.ts');
const { transcribeDictation } = await import('./transcription.ts');

const LEASE = { sessionId: 'direct-call:transcription', execId: 'e1' };
const MODEL = {
  organizationId: 'org-1',
  provider: 'openai',
  model: 'whisper-1',
  centsPerAudioMinute: 0.6,
};

function rowsSql(rows: unknown[]) {
  const tag = () => Promise.resolve(rows);
  return tag as unknown as Sql;
}

/** The recording's file row, and the chat it names: only the owner's chat
 * answers the project read, as `thread_metadata.user_id` does. */
function fileSql(
  file: Record<string, unknown> | null,
  thread?: { owner: string; projectId: string | null },
) {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('?').includes('FROM app.thread_metadata')) {
      return Promise.resolve(
        thread !== undefined && values[2] === thread.owner
          ? [{ projectId: thread.projectId }]
          : [],
      );
    }
    return Promise.resolve(file === null ? [] : [file]);
  };
  return tag as unknown as Sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openDirectCall.mockResolvedValue({ allowed: true, lease: LEASE });
});

describe('an uploaded recording’s transcription', () => {
  const row = (fields: Record<string, unknown>) => ({
    uploadedBy: 'user-1',
    projectId: null,
    threadId: null,
    status: 'queued',
    ...fields,
  });

  it('is its uploader’s spend, in the project its chat was started in [GOV-R14]', async () => {
    // A project's new chat: the composer named the project at registration.
    await expect(
      uploadTranscriptionSubject(fileSql(row({ projectId: 'project-1' })), {
        organizationId: 'org-1',
        storageId: 's3:org/rec',
      }),
    ).resolves.toEqual({
      userId: 'user-1',
      agentSlug: '__transcription__',
      projectIds: ['project-1'],
    });
    // Added to a chat the uploader owns: that chat's project.
    await expect(
      uploadTranscriptionSubject(
        fileSql(row({ threadId: 'thread-1' }), {
          owner: 'user-1',
          projectId: 'project-2',
        }),
        { organizationId: 'org-1', storageId: 's3:org/rec' },
      ),
    ).resolves.toMatchObject({ projectIds: ['project-2'] });
  });

  it('never takes the project of a chat the uploader does not own', async () => {
    await expect(
      uploadTranscriptionSubject(
        fileSql(row({ threadId: 'thread-1' }), {
          owner: 'someone-else',
          projectId: 'project-2',
        }),
        { organizationId: 'org-1', storageId: 's3:org/rec' },
      ),
    ).resolves.toEqual({ userId: 'user-1', agentSlug: '__transcription__' });
  });

  it('charges nobody for a recording that was removed, or is gone', async () => {
    await expect(
      uploadTranscriptionSubject(fileSql(row({ status: 'skipped' })), {
        organizationId: 'org-1',
        storageId: 's3:org/rec',
      }),
    ).resolves.toBeNull();
    await expect(
      uploadTranscriptionSubject(fileSql(null), {
        organizationId: 'org-1',
        storageId: 's3:org/gone',
      }),
    ).resolves.toBeNull();
    // A file nobody uploaded is the organization's.
    await expect(
      uploadTranscriptionSubject(fileSql(row({ uploadedBy: null })), {
        organizationId: 'org-1',
        storageId: 's3:org/rec',
      }),
    ).resolves.toEqual({
      userId: AUTOMATION_SUBJECT_ID,
      agentSlug: '__transcription__',
    });
  });

  it('holds its whole length at the per-minute price, and books the minutes transcribed [GOV-R5]', async () => {
    const sql = rowsSql([]);
    const subject = { userId: 'user-1', agentSlug: '__transcription__' };
    await openTranscriptionCall(sql, {
      ...MODEL,
      subject,
      audioDurationSec: 90,
    });
    expect(mocks.openDirectCall).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      lane: 'transcription',
      subject,
      worstCase: { cents: 0.9, tokens: 0 },
      modelRef: 'openai/whisper-1',
      maxDurationMs: expect.any(Number),
    });

    await settleTranscriptionCall(sql, {
      ...MODEL,
      lease: LEASE as never,
      audioDurationSec: 88,
    });
    expect(mocks.settleDirectCall).toHaveBeenCalledWith(sql, LEASE, {
      provider: 'openai',
      model: 'whisper-1',
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0.88,
      audioDurationSec: 88,
    });
  });
});

describe('transcribeDictation', () => {
  const DICTATION = {
    organizationId: 'org-1',
    userId: 'user-1',
    audio: new Uint8Array([1, 2, 3, 4]),
    mimeType: 'audio/webm',
  };
  const sql = rowsSql([]);

  it('holds the clip’s own length under the member, and books what the provider heard [GOV-R5]', async () => {
    mocks.requestTranscription.mockResolvedValue({
      text: 'Call Ada tomorrow.',
      duration: 11.5,
    });

    await expect(transcribeDictation(sql, DICTATION)).resolves.toEqual({
      text: 'Call Ada tomorrow.',
    });
    expect(mocks.openDirectCall).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        subject: { userId: 'user-1', agentSlug: '__transcription__' },
        worstCase: { cents: 0.12, tokens: 0 },
      }),
    );
    expect(mocks.settleDirectCall).toHaveBeenCalledWith(
      sql,
      LEASE,
      expect.objectContaining({ audioDurationSec: 11.5, costCents: 0.115 }),
    );
  });

  it('holds the longest the clip’s size allows when its length cannot be read, for at most two minutes', async () => {
    mocks.probeAudioDurationSec.mockResolvedValueOnce(0);
    mocks.requestTranscription.mockResolvedValue({ text: 'Hi.' });

    await transcribeDictation(sql, {
      ...DICTATION,
      audio: new Uint8Array(60_000),
    });

    expect(mocks.openDirectCall).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        // 60 000 bytes at 2 000 a second: 30 s at 0.6¢ a minute.
        worstCase: { cents: 0.3, tokens: 0 },
        maxDurationMs: 120_000,
      }),
    );
    // No length from the provider either: the bound is booked, never 0.
    expect(mocks.settleDirectCall).toHaveBeenCalledWith(
      sql,
      LEASE,
      expect.objectContaining({ audioDurationSec: 30 }),
    );
  });

  it('refuses with 429 BUDGET_EXCEEDED before the provider hears it [GOV-R4]', async () => {
    mocks.openDirectCall.mockResolvedValue({
      allowed: false,
      reason:
        'Usage limit reached. Your daily request limit is used up until …',
    });
    await expect(transcribeDictation(sql, DICTATION)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      status: 429,
    });
    expect(mocks.requestTranscription).not.toHaveBeenCalled();
  });

  it('releases the hold of a clip the provider refused', async () => {
    mocks.requestTranscription.mockRejectedValue(new Error('provider 400'));
    await expect(transcribeDictation(sql, DICTATION)).rejects.toThrow(
      'provider 400',
    );
    expect(mocks.releaseDirectCall).toHaveBeenCalledWith(sql, LEASE);
    expect(mocks.settleDirectCall).not.toHaveBeenCalled();
  });
});
