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

const mockResolveOrgSlug = vi.fn();
vi.mock('../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: (...args: unknown[]) => mockResolveOrgSlug(...args),
}));

const mockResolveTranscriptionModel = vi.fn();
vi.mock('../providers/resolve_model', () => ({
  resolveTranscriptionModel: (...args: unknown[]) =>
    mockResolveTranscriptionModel(...args),
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
    // Production now calls getAuthUserIdentity (ctx.auth.getUserIdentity)
    // instead of authComponent.getAuthUser. Derive the identity from the
    // same mock source so the existing test intent is preserved.
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
const MODEL_DATA = {
  providerName: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  modelId: 'whisper-1',
  centsPerAudioMinute: 60,
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

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockResolveOrgSlug.mockReset();
  mockResolveTranscriptionModel.mockReset();
  mockGetAuthUser.mockResolvedValue(AUTH_USER);
  mockResolveOrgSlug.mockResolvedValue('test-org');
  mockResolveTranscriptionModel.mockResolvedValue(MODEL_DATA);
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
      // Whisper must not be called before the auth check passes.
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('verifies organization membership before failing offline', async () => {
      const ctx = createMockCtx();

      // Membership is checked before the offline error so non-members never
      // learn transcription is offline.
      await expect(
        handler(ctx, {
          audio: makeAudio(100),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/offline/i);

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
    });
  });

  describe('input guards', () => {
    it('returns empty text for zero-byte audio without calling Whisper', async () => {
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

    it('accepts audio at exactly 8 MiB (passes the size guard to the offline error)', async () => {
      const ctx = createMockCtx();

      // At the cap it is NOT rejected as too large; it passes the guard and
      // reaches the offline error like any in-bound request.
      await expect(
        handler(ctx, {
          audio: makeAudio(8 * 1024 * 1024),
          mimeType: 'audio/webm',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/offline/i);
    });
  });

  describe('offline contract', () => {
    it('throws a typed offline error for an in-bound request, without calling Whisper', async () => {
      const ctx = createMockCtx();
      const fetchSpy = vi.fn();
      globalThis.fetch = Object.assign(fetchSpy, { preconnect: vi.fn() });

      await expect(
        handler(ctx, {
          audio: makeAudio(256),
          mimeType: 'audio/ogg;codecs=opus',
          organizationId: ORG_ID,
        }),
      ).rejects.toThrow(/offline while the platform AI backend is rewritten/i);

      // No upstream transcription call and no usage recording while offline.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });
  });
});
