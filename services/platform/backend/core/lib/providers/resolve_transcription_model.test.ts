/**
 * The transcription model resolver walks the org's `openai`-format providers
 * for the first `transcription`-tagged entry the provider's DIRECT default
 * credential can serve — its model allowlist applied the way the composer's
 * `voice.transcriptionAvailable` flag applies it, so the dictation button,
 * the upload pipeline, and this resolver never disagree. These tests pin
 * the walk, the allowlist agreement, and the `NO_TRANSCRIPTION_MODEL`
 * refusal.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import type { ActionCtx } from '../ctx';

const resolveProvidersMock = vi.fn();
vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: (...args: unknown[]) =>
    resolveProvidersMock(...(args as [])),
}));

const catalogMock = vi.fn();
vi.mock('./servable_catalog', () => ({
  getServableCatalog: (...args: unknown[]) => catalogMock(...(args as [])),
}));

const credentialMock = vi.fn();
vi.mock('../../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: (...args: unknown[]) =>
    credentialMock(...(args as [])),
}));

import { resolveTranscriptionModel } from './resolve_transcription_model';

const ORG = 'org_a';
const ACTIVE_API_KEY_ROW = { authMethod: 'api-key', status: 'active' };

/** The provider's default credential row, keyed by provider slug; a
 * provider not listed gets an active api-key row without an allowlist. */
let defaultRows: Record<string, unknown> = {};
const runQuery = vi.fn(async (_ref: unknown, args: { providerSlug: string }) =>
  args.providerSlug in defaultRows
    ? defaultRows[args.providerSlug]
    : ACTIVE_API_KEY_ROW,
);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
const ctx = { runQuery } as unknown as ActionCtx;

function provider(name: string, apiFormat: 'openai' | 'anthropic' = 'openai') {
  return { name, apiFormat, baseUrl: `https://${name}.example/v1` };
}

const WHISPER = { id: 'whisper-1', tags: ['transcription'] };
const CHAT_ONLY = { id: 'gpt-4o', tags: ['chat'] };

function apiKeyCredential(secret = 'sk-test') {
  return { authMethod: 'api-key', secret, endpointUrl: undefined };
}

async function caughtCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) {
      const data: unknown = err.data;
      if (data && typeof data === 'object' && 'code' in data) {
        const code = (data as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
    throw err;
  }
  throw new Error('expected the resolver to throw');
}

beforeEach(() => {
  resolveProvidersMock.mockReset();
  catalogMock.mockReset();
  credentialMock.mockReset();
  runQuery.mockClear();
  defaultRows = {};
});

describe('resolveTranscriptionModel', () => {
  it('resolves the first transcription entry a direct default credential serves', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('anthropic', 'anthropic'),
      provider('openai'),
    ]);
    catalogMock.mockResolvedValue([CHAT_ONLY, WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    });
    expect(resolved).toEqual({
      modelId: 'whisper-1',
      providerName: 'openai',
      baseUrl: 'https://openai.example/v1',
      apiKey: 'sk-test',
    });
    // The Anthropic Messages format has no transcription endpoint: that
    // provider is skipped before any credential or catalog read.
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(catalogMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the credential endpoint over the provider base URL', async () => {
    resolveProvidersMock.mockResolvedValue([provider('azure')]);
    catalogMock.mockResolvedValue([WHISPER]);
    credentialMock.mockResolvedValue({
      ...apiKeyCredential(),
      endpointUrl: 'https://tenant.openai.azure.com/openai',
    });

    const resolved = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    });
    expect(resolved.baseUrl).toBe('https://tenant.openai.azure.com/openai');
  });

  it('never fetches a catalog for a provider without an active direct default credential', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('no-credential'),
      provider('disabled'),
      provider('subscription'),
    ]);
    defaultRows = {
      'no-credential': null,
      disabled: { authMethod: 'api-key', status: 'disabled' },
      subscription: { authMethod: 'subscription-key', status: 'active' },
    };
    catalogMock.mockResolvedValue([WHISPER]);

    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('NO_TRANSCRIPTION_MODEL');
    expect(catalogMock).not.toHaveBeenCalled();
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('skips an unreachable catalog and a provider with no transcription entry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveProvidersMock.mockResolvedValue([
      provider('flaky'),
      provider('chat-only'),
    ]);
    catalogMock.mockImplementation(async (c: { name: string }) => {
      if (c.name === 'flaky') throw new Error('catalog unreachable');
      return [CHAT_ONLY];
    });

    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('NO_TRANSCRIPTION_MODEL');
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('refuses a transcription model the allowlist of the default credential excludes, as the composer flag does', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['gpt-4o'] },
    };
    catalogMock.mockResolvedValue([CHAT_ONLY, WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('NO_TRANSCRIPTION_MODEL');
    // The catalog is read through the servable seam WITH the allowlist —
    // the same read the composer's listing makes.
    expect(catalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openai' }),
      ['gpt-4o'],
    );
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('serves the transcription model when the allowlist names it', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['whisper-1'] },
    };
    catalogMock.mockResolvedValue([CHAT_ONLY, WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    });
    expect(resolved.modelId).toBe('whisper-1');
  });
});
