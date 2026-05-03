import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/server', () => ({
  mutation: (config: Record<string, unknown>) => config,
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
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

vi.mock('../../lib/rls/auth/require_authenticated_user', () => ({
  requireAuthenticatedUser: vi
    .fn()
    .mockResolvedValue({ userId: 'u_1', email: 'u_1@example.com' }),
}));

vi.mock('../../lib/rls/auth/assert_self_and_org_member', () => ({
  assertSelfAndOrgMember: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/context_management/estimate_tokens', () => ({
  estimateTokens: (s: string) => Math.ceil(s.length / 4),
}));

interface FakePrefsRow {
  _id: string;
  userId: string;
  organizationId: string;
  customInstructions: string;
  enabled?: boolean;
  updatedAt: number;
}

function createMockCtx({ row }: { row?: FakePrefsRow } = {}) {
  const inserted: FakePrefsRow[] = [];
  const patches: Array<{ id: string; payload: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          first: vi.fn(async () => row ?? null),
        })),
      })),
      insert: vi.fn(async (_table: string, doc: FakePrefsRow) => {
        const id = `prefs_${inserted.length + 1}`;
        inserted.push({ ...doc, _id: id });
        return id;
      }),
      patch: vi.fn(async (id: string, payload: Record<string, unknown>) => {
        patches.push({ id, payload });
      }),
    },
  };

  return { ctx, inserted, patches };
}

async function getUpsert() {
  const mod = await import('../mutations');
  type WithHandler = { handler: (...args: unknown[]) => Promise<unknown> };
  return (mod.upsertMyPreferences as unknown as WithHandler).handler;
}

const ORG = 'org_1';

describe('upsertMyPreferences — customInstructions newline handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a multi-line string with LF newlines and persists it as-is on insert', async () => {
    const upsert = await getUpsert();
    const { ctx, inserted } = createMockCtx();

    await upsert(ctx, {
      organizationId: ORG,
      customInstructions: 'line one\nline two\nline three',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.customInstructions).toBe(
      'line one\nline two\nline three',
    );
  });

  it('normalizes CRLF and lone CR to LF before persisting', async () => {
    const upsert = await getUpsert();
    const { ctx, inserted } = createMockCtx();

    await upsert(ctx, {
      organizationId: ORG,
      customInstructions: 'crlf\r\nlone-cr\rtail',
    });

    expect(inserted[0]?.customInstructions).toBe('crlf\nlone-cr\ntail');
  });

  it('persists normalized content on patch (existing row)', async () => {
    const upsert = await getUpsert();
    const existing: FakePrefsRow = {
      _id: 'prefs_existing',
      userId: 'u_1',
      organizationId: ORG,
      customInstructions: 'old',
      updatedAt: 1,
    };
    const { ctx, patches } = createMockCtx({ row: existing });

    await upsert(ctx, {
      organizationId: ORG,
      customInstructions: 'a\r\nb',
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]?.payload.customInstructions).toBe('a\nb');
  });

  it('accepts the empty string (clearing the field)', async () => {
    const upsert = await getUpsert();
    const { ctx, inserted } = createMockCtx();

    await upsert(ctx, { organizationId: ORG, customInstructions: '' });

    expect(inserted[0]?.customInstructions).toBe('');
  });

  it('rejects backtick', async () => {
    const upsert = await getUpsert();
    const { ctx } = createMockCtx();

    await expect(
      upsert(ctx, { organizationId: ORG, customInstructions: 'foo `cmd` bar' }),
    ).rejects.toMatchObject({
      data: { code: 'invalid' },
    });
  });

  it('rejects angle brackets', async () => {
    const upsert = await getUpsert();
    const { ctx } = createMockCtx();

    await expect(
      upsert(ctx, {
        organizationId: ORG,
        customInstructions: '<script>x</script>',
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });
  });

  it('rejects C0 control characters (NUL, BEL, vertical tab, ESC)', async () => {
    const upsert = await getUpsert();

    for (const ch of ['\x00', '\x07', '\x0b', '\x1b']) {
      const { ctx } = createMockCtx();
      await expect(
        upsert(ctx, {
          organizationId: ORG,
          customInstructions: `bad${ch}char`,
        }),
      ).rejects.toMatchObject({ data: { code: 'invalid' } });
    }
  });

  it('rejects DEL (\\x7f)', async () => {
    const upsert = await getUpsert();
    const { ctx } = createMockCtx();

    await expect(
      upsert(ctx, {
        organizationId: ORG,
        customInstructions: 'bad\x7fchar',
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });
  });

  it('error message no longer mentions newlines', async () => {
    const upsert = await getUpsert();
    const { ctx } = createMockCtx();

    await expect(
      upsert(ctx, { organizationId: ORG, customInstructions: 'oops `cmd`' }),
    ).rejects.toMatchObject({
      data: {
        code: 'invalid',
        message: expect.stringMatching(
          /^(?!.*newlines).*disallowed characters/,
        ),
      },
    });
  });

  it('rejects content exceeding the character cap (after CRLF normalization)', async () => {
    const upsert = await getUpsert();
    const { ctx } = createMockCtx();

    // CRLF doubles the source length; we want post-normalization length to exceed 4000.
    const longLF = 'a'.repeat(4001);
    await expect(
      upsert(ctx, { organizationId: ORG, customInstructions: longLF }),
    ).rejects.toMatchObject({ data: { code: 'too_long' } });
  });
});
