import { beforeEach, describe, expect, it, vi } from 'vitest';

// Expose the mutation `.handler` directly so we can call it with a mock ctx —
// same pattern as file_metadata/mutations.test.ts.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../_generated/api', () => ({
  internal: {
    knowledge_entries: {
      internal_actions: { materializeKnowledgeEntry: 'mock' },
    },
  },
}));

// Auth + org membership + rate limit all pass; the duplicate guard is what we
// exercise here.
vi.mock('../lib/rate_limiter/helpers', () => ({
  checkOrganizationRateLimit: vi.fn(),
}));
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn().mockResolvedValue({ role: 'member' }),
}));

import { ConvexError } from 'convex/values';

import { createKnowledgeEntry, updateKnowledgeEntry } from './mutations';

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;

function codeOf(err: unknown): string | undefined {
  if (!(err instanceof ConvexError)) return undefined;
  const data: unknown = err.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const candidate: unknown = (data as { code: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

const AUTH_USER = {
  subject: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};

// A live active entry the duplicate guard should detect.
const EXISTING_ENTRY = {
  _id: 'entry_existing',
  organizationId: 'org_1',
  topic: 'Refunds',
  topicKey: 'refunds',
  status: 'active' as const,
  deletedAt: undefined,
};

/** Mock ctx whose `knowledgeEntries` lookups resolve to `existing`. */
function createMockCtx(existing: unknown) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existing),
  };
  return {
    auth: { getUserIdentity: vi.fn().mockResolvedValue(AUTH_USER) },
    db: {
      query: vi.fn().mockReturnValue(builder),
      get: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
    },
    scheduler: { runAfter: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('knowledge entry duplicate guard (#2056)', () => {
  // Regression: the duplicate rejection must carry a structured ConvexError
  // code. A raw `Error` is redacted to "Server Error" in prod, killing the
  // dialog's duplicate detection.
  it('createKnowledgeEntry throws ConvexError({ code: KNOWLEDGE_ENTRY_DUPLICATE }) on a topic collision', async () => {
    const handler = (createKnowledgeEntry as unknown as { handler: Handler })
      .handler;
    const ctx = createMockCtx(EXISTING_ENTRY);

    let code: string | undefined;
    try {
      await handler(ctx, {
        organizationId: 'org_1',
        topic: 'Refunds',
        content: 'How refunds work.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_DUPLICATE');
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('updateKnowledgeEntry throws the duplicate code when a rename collides with a live topic', async () => {
    const handler = (updateKnowledgeEntry as unknown as { handler: Handler })
      .handler;
    const ctx = createMockCtx(EXISTING_ENTRY);
    // The edited entry itself — a different active row being renamed.
    ctx.db.get = vi.fn().mockResolvedValue({
      _id: 'entry_edited',
      organizationId: 'org_1',
      topic: 'Returns',
      topicKey: 'returns',
      status: 'active',
      deletedAt: undefined,
    });

    let code: string | undefined;
    try {
      await handler(ctx, {
        entryId: 'entry_edited',
        topic: 'Refunds', // collides with EXISTING_ENTRY's topicKey
        content: 'Renamed content.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_DUPLICATE');
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
