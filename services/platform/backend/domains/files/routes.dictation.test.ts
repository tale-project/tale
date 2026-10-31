// @vitest-environment node

/**
 * `POST /files/dictation` transcribes the composer's recording inline. With
 * the organization's EU/EEA processing rule on (GOV-R17), the resolver
 * refuses a model whose endpoint may process outside the region before any
 * audio leaves; the door answers 403 with the gate's code, which the
 * composer keys its notice on, and the gate's sentence, which says what an
 * admin can change.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { ModelEndpointRefusal } from '../../core/governance/model_endpoint_gate.ts';
import { TranscriptionModelError } from '../../core/lib/providers/resolve_transcription_model.ts';
import { createFileRoutes } from './routes.ts';
import { transcribeDictation } from './transcription.ts';

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', { user: { id: 'user_1' } });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('orgId', 'org_1');
      c.set('orgMember', { role: 'member' });
      await next();
    },
}));
vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(() => Promise.resolve()),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));
vi.mock('./transcription.ts', () => ({
  queueTranscription: vi.fn(() => Promise.resolve()),
  retryTranscription: vi.fn(() => Promise.resolve()),
  skipTranscription: vi.fn(() => Promise.resolve()),
  transcribeDictation: vi.fn(() => Promise.resolve({ text: 'hello' })),
}));

function dictate() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked middleware never touches either dependency
  return createFileRoutes({ sql: {} as Sql, auth: {} as Auth }).request(
    '/dictation',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audioBase64: Buffer.from('voice').toString('base64'),
        mimeType: 'audio/webm',
      }),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /files/dictation', () => {
  it('transcribes for the session’s member', async () => {
    const res = await dictate();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'hello' });
    expect(transcribeDictation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org_1', userId: 'user_1' }),
    );
  });

  it.each([
    [
      'MODEL_ENDPOINT_OUTSIDE_EU',
      'This organization processes prompts only in the EU/EEA, and api.openai.com may process prompts outside it, so the call was not sent.',
    ],
    [
      'MODEL_ENDPOINT_POLICY_UNREADABLE',
      'The model access policy could not be read, so the call was not sent.',
    ],
  ] as const)(
    'answers a refusal of the EU/EEA rule with 403, its code and its sentence: %s [GOV-R17]',
    async (code, message) => {
      vi.mocked(transcribeDictation).mockRejectedValueOnce(
        new ModelEndpointRefusal({ code, message, provider: 'openai' }),
      );
      const res = await dictate();
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: code, message });
    },
  );

  it('keeps a missing model a 409 with its code alone', async () => {
    vi.mocked(transcribeDictation).mockRejectedValueOnce(
      new TranscriptionModelError('NO_TRANSCRIPTION_MODEL'),
    );
    const res = await dictate();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'NO_TRANSCRIPTION_MODEL',
    });
  });
});
