import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import { requestTranscription } from '../../file_metadata/transcription_request';
import type { ActionCtx } from '../ctx';
import { invalidateCatalogFetchCache } from './catalog_fetch';
import {
  inspectTranscriptionModels,
  resolveTranscriptionModel,
} from './resolve_transcription_model';

const providerMock = vi.fn();
vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: (...args: unknown[]) => providerMock(...args),
}));
vi.mock('../../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: async () => ({
    authMethod: 'api-key',
    secret: 'synthetic-transcription-key',
  }),
}));
vi.mock('../../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/net/safe-fetch')>()),
  safeFetch: vi.fn(),
}));

const OPENROUTER = providerDefinitionSchema.parse({
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'openrouter-api' },
  auth: [{ method: 'api-key' }],
});
const STT_URL =
  'https://openrouter.ai/api/v1/models?output_modalities=transcription';
// Match the dedicated catalog's real wire shape: STT is an output modality,
// and a duration-based model has no chat token context window.
const STT_PAYLOAD = {
  data: ['deepgram/nova-3', 'openai/whisper-large-v3'].map((id) => ({
    id,
    context_length: 0,
    architecture: {
      input_modalities: ['audio'],
      output_modalities: ['transcription'],
    },
    pricing: { prompt: '0.0043', completion: '0' },
    supported_parameters: [],
  })),
};

let pin: unknown;
let allowlist: string[] | undefined;
const ctx = {
  runQuery: async (_ref: unknown, args: { policyType?: string }) =>
    args.policyType
      ? pin
      : {
          authMethod: 'api-key',
          status: 'active',
          modelAllowlist: allowlist,
        },
} as unknown as ActionCtx;

beforeEach(() => {
  pin = null;
  allowlist = undefined;
  providerMock.mockResolvedValue([OPENROUTER]);
  vi.mocked(safeFetch).mockImplementation(async (url) => {
    if (url !== STT_URL) throw new Error('unexpected chat catalog dependency');
    return {
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: JSON.stringify(STT_PAYLOAD),
      finalUrl: STT_URL,
    };
  });
});

afterEach(() => {
  invalidateCatalogFetchCache();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('OpenRouter transcription discovery through the serving request', () => {
  it('discovers raw zero-context STT models and sends the automatic selection with portable JSON', async () => {
    const status = await inspectTranscriptionModels(ctx, 'org-with-openrouter');
    expect(status.error).toBeUndefined();
    expect(status.models.map(({ modelId }) => modelId)).toEqual([
      'deepgram/nova-3',
      'openai/whisper-large-v3',
    ]);
    expect(status.pick).toEqual({
      providerSlug: 'openrouter',
      modelId: 'deepgram/nova-3',
      source: 'automatic',
    });
    expect(JSON.stringify(status)).not.toContain('synthetic-transcription-key');

    const model = await resolveTranscriptionModel(ctx, {
      organizationId: 'org-with-openrouter',
    });
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ text: 'Audio test.', usage: { seconds: 2.5 } }),
      );
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' });
    const transcript = await requestTranscription({
      model,
      blob: audio,
      fileName: 'audio.ogg',
      timeoutMs: 1000,
    });
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    const body = init?.body as FormData;
    expect(body.get('model')).toBe(status.pick?.modelId);
    expect(body.get('response_format')).toBe('json');
    expect(await (body.get('file') as Blob).arrayBuffer()).toEqual(
      await audio.arrayBuffer(),
    );
    expect(transcript).toEqual({
      text: 'Audio test.',
      duration: 2.5,
      segments: undefined,
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(safeFetch).mock.calls.map(([catalogUrl]) => catalogUrl),
    ).toEqual([STT_URL]);
  });

  it('applies the existing credential allowlist and exact pin to the discovered models', async () => {
    allowlist = ['openai/whisper-large-v3'];
    expect(
      (await inspectTranscriptionModels(ctx, 'org-with-openrouter')).pick
        ?.modelId,
    ).toBe('openai/whisper-large-v3');
    pin = { providerSlug: 'openrouter', modelId: 'deepgram/nova-3' };
    expect(
      await inspectTranscriptionModels(ctx, 'org-with-openrouter'),
    ).toMatchObject({
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_UNAVAILABLE' },
    });
    pin = null;
    allowlist = ['chat-only'];
    expect(
      await inspectTranscriptionModels(ctx, 'org-with-openrouter'),
    ).toMatchObject({
      models: [],
      pick: null,
      error: { code: 'NO_TRANSCRIPTION_MODEL' },
    });
  });

  it('reports an unreachable STT catalog as retryable resolution failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      vi.mocked(safeFetch).mockRejectedValue(
        new SafeFetchError('network_error', 'unreachable'),
      );
      const pending = inspectTranscriptionModels(ctx, 'org-with-openrouter');
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({
        models: [],
        pick: null,
        error: { code: 'TRANSCRIPTION_MODEL_RESOLUTION_FAILED' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
