import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — wire up the action wrapper and every Convex helper before the
// module under test is imported.
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
  // Spread the real module so transitively-loaded builders (e.g. internalQuery
  // from lib/get_user_teams, now reachable via the lib/rls barrel) stay defined.
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: vi.fn((config) => config),
    internalAction: vi.fn((config) => config),
  };
});

vi.mock('../_generated/api', () => ({
  internal: {
    approvals: {
      internal_queries: {
        verifyOrganizationMembership: 'verifyOrganizationMembership',
      },
    },
    governance: {
      internal_mutations: {
        recordTranscriptionUsage: 'recordTranscriptionUsage',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

// The provider plane the resolver walks: org connectors, their catalogs, and
// the (org, provider) default credential. Each test shapes these three.
const mockResolveProvidersForOrgId = vi.fn();
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: (...args: unknown[]) =>
    mockResolveProvidersForOrgId(...args),
}));

const mockGetProviderCatalog = vi.fn();
vi.mock('../lib/providers/catalog_fetch', () => ({
  getProviderCatalog: (...args: unknown[]) => mockGetProviderCatalog(...args),
}));

const mockResolveProviderCredential = vi.fn();
vi.mock('../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: (...args: unknown[]) =>
    mockResolveProviderCredential(...args),
}));

// Host policy is policed by its own unit tests; here it only needs to be
// observable (defense-in-depth call) and permissive by default.
const mockCheckHostPolicy = vi.fn();
vi.mock('../lib/http/host_policy', () => ({
  checkProviderHostPolicy: (...args: unknown[]) => mockCheckHostPolicy(...args),
}));

vi.mock('../governance/cost_estimation', () => ({
  estimateTranscriptionCostCents: (sec: number, perMin: number | undefined) =>
    perMin ? Math.round((sec / 60) * perMin) : 0,
}));

vi.mock('../../lib/shared/constants/usage', () => ({
  TRANSCRIPTION_SLUG: '__transcription__',
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered.
// ---------------------------------------------------------------------------

const { transcribeDictation, pickExtensionFromMime } =
  await import('./transcribe_dictation');

type ActionConfig = {
  handler: (
    ctx: unknown,
    args: {
      audio: ArrayBuffer;
      mimeType: string;
      organizationId: string;
    },
  ) => Promise<{ text: string }>;
};

const handler = (transcribeDictation as unknown as ActionConfig).handler;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockCtx {
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
  auth: { getUserIdentity: ReturnType<typeof vi.fn> };
}

function createMockCtx(): MockCtx {
  return {
    runQuery: vi.fn().mockResolvedValue(undefined),
    runMutation: vi.fn().mockResolvedValue(null),
    // Production calls getAuthUserIdentity (ctx.auth.getUserIdentity). Derive
    // the identity from the same mock source so the test intent stays in one
    // place.
    auth: {
      getUserIdentity: vi.fn(async () => {
        const u = await mockGetAuthUser();
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
  };
}

function makeAudio(byteLength: number): ArrayBuffer {
  return new Uint8Array(byteLength).fill(1).buffer;
}

const ORG_ID = 'org_test';
const AUTH_USER = { _id: 'user_123', email: 'ym@tale.dev', name: 'YM' };

/** An openai-format connector with a fixed base URL (the qualifying shape). */
const OPENAI_PROVIDER = {
  name: 'openai',
  displayName: 'OpenAI',
  apiFormat: 'openai',
  baseUrl: 'https://api.example.com/v1',
  catalog: { source: 'static' },
  auth: [{ method: 'api-key' }],
};

/** An anthropic-format connector — its wire has no transcription endpoint. */
const ANTHROPIC_PROVIDER = {
  ...OPENAI_PROVIDER,
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.example/v1',
};

const TRANSCRIPTION_ENTRY = {
  id: 'whisper-1',
  provider: 'openai',
  tags: ['transcription'],
  supportsTools: false,
  supportsVision: false,
  contextWindow: 2000,
};

const CHAT_ENTRY = {
  id: 'gpt-5.5',
  provider: 'openai',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 400000,
};

const DIRECT_CREDENTIAL = {
  authMethod: 'api-key',
  credentialId: 'cred_1',
  name: 'Default',
  secret: 'sk-test',
};

const originalFetch = globalThis.fetch;

function mockWhisperResponse(body: unknown, init: ResponseInit = {}) {
  globalThis.fetch = Object.assign(
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    ),
    { preconnect: vi.fn() },
  );
}

function mockWhisperError(status: number, body = 'upstream error') {
  globalThis.fetch = Object.assign(
    vi.fn().mockResolvedValue(new Response(body, { status })),
    { preconnect: vi.fn() },
  );
}

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockResolveProvidersForOrgId.mockReset();
  mockGetProviderCatalog.mockReset();
  mockResolveProviderCredential.mockReset();
  mockCheckHostPolicy.mockReset();
  mockGetAuthUser.mockResolvedValue(AUTH_USER);
  mockResolveProvidersForOrgId.mockResolvedValue([OPENAI_PROVIDER]);
  mockGetProviderCatalog.mockResolvedValue([CHAT_ENTRY, TRANSCRIPTION_ENTRY]);
  mockResolveProviderCredential.mockResolvedValue(DIRECT_CREDENTIAL);
  mockCheckHostPolicy.mockImplementation((url: string) => new URL(url));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pickExtensionFromMime', () => {
  // Drives the Whisper file-extension mapping — wrong ext → API 400.
  const cases: Array<[mime: string, ext: string]> = [
    ['audio/ogg', 'ogg'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/webm', 'webm'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/m4a', 'm4a'],
    ['audio/aac', 'm4a'],
    ['audio/wav', 'wav'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['AUDIO/OGG', 'ogg'],
    ['weird/unknown', 'webm'],
    ['', 'webm'],
  ];
  it.each(cases)('maps %s → %s', (mime, ext) => {
    expect(pickExtensionFromMime(mime)).toBe(ext);
  });
});

describe('transcribeDictation handler', () => {
  describe('auth + authorization', () => {
    it('throws when unauthenticated', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      mockWhisperResponse({ text: 'x' });

      await expect(
        handler(createMockCtx(), {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
      // The provider must not be called before the auth check passes.
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('verifies organization membership before transcribing', async () => {
      mockWhisperResponse({ text: 'hello' });
      const ctx = createMockCtx();

      await handler(ctx, {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });

      expect(ctx.runQuery).toHaveBeenCalledWith(
        'verifyOrganizationMembership',
        {
          organizationId: ORG_ID,
          userId: 'user_123',
          email: 'ym@tale.dev',
          name: 'YM',
        },
      );
    });

    it('aborts when org-membership query throws', async () => {
      mockWhisperResponse({ text: 'hello' });
      const ctx = createMockCtx();
      ctx.runQuery.mockRejectedValueOnce(new Error('Not a member of org'));

      await expect(
        handler(ctx, {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/Not a member of org/);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      // Provider resolution must not run for non-members either — it would
      // leak which orgs have transcription configured.
      expect(mockResolveProvidersForOrgId).not.toHaveBeenCalled();
    });
  });

  describe('input guards', () => {
    it('returns empty text for zero-byte audio without calling the provider', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'should not be called' });

      const result = await handler(ctx, {
        audio: new ArrayBuffer(0),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });

      expect(result).toEqual({ text: '' });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      // No usage recording either.
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });

    it('throws when audio exceeds 8 MiB cap', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'x' });

      await expect(
        handler(ctx, {
          audio: makeAudio(8 * 1024 * 1024 + 1),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({
        data: { code: 'DICTATION_TOO_LARGE', maxBytes: 8 * 1024 * 1024 },
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('accepts audio at exactly 8 MiB', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'ok' });

      const result = await handler(ctx, {
        audio: makeAudio(8 * 1024 * 1024),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });
      expect(result.text).toBe('ok');
    });
  });

  describe('model resolution (connector-plane walk)', () => {
    it('refuses with NO_TRANSCRIPTION_MODEL when no catalog entry carries the tag', async () => {
      mockGetProviderCatalog.mockResolvedValue([CHAT_ENTRY]);
      mockWhisperResponse({ text: 'x' });

      await expect(
        handler(createMockCtx(), {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ data: { code: 'NO_TRANSCRIPTION_MODEL' } });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('skips anthropic-format connectors — that wire has no transcription endpoint', async () => {
      // Even with a (mis)tagged entry, an anthropic-format connector can't
      // answer `/audio/transcriptions`.
      mockResolveProvidersForOrgId.mockResolvedValue([ANTHROPIC_PROVIDER]);
      mockGetProviderCatalog.mockResolvedValue([TRANSCRIPTION_ENTRY]);
      mockWhisperResponse({ text: 'x' });

      await expect(
        handler(createMockCtx(), {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ data: { code: 'NO_TRANSCRIPTION_MODEL' } });
      // The anthropic connector's catalog is never even fetched.
      expect(mockGetProviderCatalog).not.toHaveBeenCalled();
    });

    it('skips subscription credentials (harness-bound, no direct HTTP)', async () => {
      mockResolveProviderCredential.mockResolvedValue({
        authMethod: 'subscription-key',
        credentialId: 'cred_sub',
        name: 'Coding plan',
        secret: 'sub-secret',
      });
      mockWhisperResponse({ text: 'x' });

      await expect(
        handler(createMockCtx(), {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ data: { code: 'NO_TRANSCRIPTION_MODEL' } });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('walks past a provider whose catalog is unreachable and serves from the next', async () => {
      const secondProvider = {
        ...OPENAI_PROVIDER,
        name: 'custom-gateway',
        baseUrl: 'https://gateway.example/v1',
      };
      mockResolveProvidersForOrgId.mockResolvedValue([
        OPENAI_PROVIDER,
        secondProvider,
      ]);
      mockGetProviderCatalog
        .mockRejectedValueOnce(new Error('catalog fetch returned HTTP 502'))
        .mockResolvedValueOnce([TRANSCRIPTION_ENTRY]);
      mockWhisperResponse({ text: 'served by the second provider' });

      const result = await handler(createMockCtx(), {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });

      expect(result.text).toBe('served by the second provider');
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
      expect(url).toBe('https://gateway.example/v1/audio/transcriptions');
    });

    it("prefers the credential's endpointUrl over the provider baseUrl", async () => {
      mockResolveProviderCredential.mockResolvedValue({
        ...DIRECT_CREDENTIAL,
        endpointUrl: 'https://my-resource.example/openai/v1',
      });
      mockWhisperResponse({ text: 'hi' });

      await handler(createMockCtx(), {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
      expect(url).toBe(
        'https://my-resource.example/openai/v1/audio/transcriptions',
      );
    });

    it('re-checks host policy on the resolved base URL before the request', async () => {
      mockWhisperResponse({ text: 'hi' });

      await handler(createMockCtx(), {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });
      expect(mockCheckHostPolicy).toHaveBeenCalledWith(
        'https://api.example.com/v1',
      );
    });

    it('propagates a host-policy rejection without calling the provider', async () => {
      mockCheckHostPolicy.mockImplementation(() => {
        throw new Error('Host "169.254.169.254" is blocked');
      });
      mockWhisperResponse({ text: 'x' });

      await expect(
        handler(createMockCtx(), {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/blocked/);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Whisper request', () => {
    it('POSTs to the resolved model URL with the right form fields', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'hello world' });

      await handler(ctx, {
        audio: makeAudio(256),
        mimeType: 'audio/ogg;codecs=opus',
        organizationId: ORG_ID,
      });

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
      expect(url).toBe('https://api.example.com/v1/audio/transcriptions');
      // Bearer header must be set so the upstream auths.
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        'Bearer sk-test',
      );
      const body = init?.body as FormData;
      expect(body.get('model')).toBe('whisper-1');
      expect(body.get('response_format')).toBe('verbose_json');
      const file = body.get('file');
      expect(file).toBeInstanceOf(Blob);
      // Filename has the right extension for the recorded MIME — Whisper
      // validates by extension, so `.ogg` matters.
      expect((file as File).name).toBe('dictation.ogg');
    });

    it('throws with status + truncated upstream body on non-OK', async () => {
      const ctx = createMockCtx();
      mockWhisperError(429, 'rate limited please retry');

      await expect(
        handler(ctx, {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/Transcription API 429: rate limited/);
    });

    it('handles non-OK responses whose body cannot be read', async () => {
      const ctx = createMockCtx();
      globalThis.fetch = Object.assign(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: vi.fn().mockRejectedValue(new Error('stream closed')),
        }),
        { preconnect: vi.fn() },
      );

      await expect(
        handler(ctx, {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/Transcription API 500/);
    });
  });

  describe('response handling + usage', () => {
    it('returns the transcribed text on success', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'the quick brown fox', duration: 3 });

      const result = await handler(ctx, {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });
      expect(result).toEqual({ text: 'the quick brown fox' });
    });

    it('defaults missing text field to empty string (passes v.string() validator)', async () => {
      const ctx = createMockCtx();
      // Some OpenAI-compatible servers return `{}` for empty audio.
      mockWhisperResponse({});

      const result = await handler(ctx, {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });
      expect(result).toEqual({ text: '' });
    });

    it('records transcription usage when duration is known', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'hi', duration: 60 });

      await handler(ctx, {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });

      expect(ctx.runMutation).toHaveBeenCalledWith(
        'recordTranscriptionUsage',
        expect.objectContaining({
          organizationId: ORG_ID,
          userId: 'user_123',
          agentSlug: '__transcription__',
          model: 'whisper-1',
          provider: 'openai',
          audioDurationSec: 60,
          // The rewritten catalog schema carries no per-minute transcription
          // price, so the estimate is 0 — minutes are still recorded.
          costEstimateCents: 0,
        }),
      );
    });

    it('skips usage recording when duration is missing or zero', async () => {
      const ctx = createMockCtx();
      mockWhisperResponse({ text: 'hi' });

      await handler(ctx, {
        audio: makeAudio(100),
        mimeType: 'audio/webm',
        organizationId: ORG_ID,
      });

      expect(ctx.runMutation).not.toHaveBeenCalled();
    });
  });
});
