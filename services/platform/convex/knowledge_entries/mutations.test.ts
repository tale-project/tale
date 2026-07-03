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

import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  updateKnowledgeEntry,
} from './mutations';

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

// Regression for #2000: every public mutation must reject with a structured
// ConvexError code rather than a raw `Error`, which Convex redacts to an opaque
// "Server Error" in prod — losing the message the UI needs to render feedback.
describe('knowledge entry structured errors (#2000)', () => {
  function handlerOf(fn: unknown): Handler {
    return (fn as { handler: Handler }).handler;
  }

  it('createKnowledgeEntry throws UNAUTHENTICATED when there is no auth user', async () => {
    const ctx = createMockCtx(null);
    ctx.auth.getUserIdentity = vi.fn().mockResolvedValue(null);

    let code: string | undefined;
    try {
      await handlerOf(createKnowledgeEntry)(ctx, {
        organizationId: 'org_1',
        topic: 'Refunds',
        content: 'How refunds work.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('UNAUTHENTICATED');
  });

  it('createKnowledgeEntry throws KNOWLEDGE_ENTRY_TOPIC_REQUIRED for a blank topic', async () => {
    const ctx = createMockCtx(null);

    let code: string | undefined;
    try {
      await handlerOf(createKnowledgeEntry)(ctx, {
        organizationId: 'org_1',
        topic: '   ',
        content: 'How refunds work.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_TOPIC_REQUIRED');
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('createKnowledgeEntry throws KNOWLEDGE_ENTRY_CONTENT_REQUIRED for blank content', async () => {
    const ctx = createMockCtx(null);

    let code: string | undefined;
    try {
      await handlerOf(createKnowledgeEntry)(ctx, {
        organizationId: 'org_1',
        topic: 'Refunds',
        content: '   ',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_CONTENT_REQUIRED');
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('updateKnowledgeEntry throws UNAUTHENTICATED when there is no auth user', async () => {
    const ctx = createMockCtx(null);
    ctx.auth.getUserIdentity = vi.fn().mockResolvedValue(null);

    let code: string | undefined;
    try {
      await handlerOf(updateKnowledgeEntry)(ctx, {
        entryId: 'entry_existing',
        topic: 'Refunds',
        content: 'How refunds work.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('UNAUTHENTICATED');
  });

  it('updateKnowledgeEntry throws KNOWLEDGE_ENTRY_NOT_FOUND for a missing entry', async () => {
    const ctx = createMockCtx(null);
    ctx.db.get = vi.fn().mockResolvedValue(null);

    let code: string | undefined;
    try {
      await handlerOf(updateKnowledgeEntry)(ctx, {
        entryId: 'entry_missing',
        topic: 'Refunds',
        content: 'How refunds work.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_NOT_FOUND');
  });

  it('updateKnowledgeEntry throws KNOWLEDGE_ENTRY_NOT_ACTIVE for a superseded entry', async () => {
    const ctx = createMockCtx(null);
    ctx.db.get = vi.fn().mockResolvedValue({
      _id: 'entry_old',
      organizationId: 'org_1',
      topic: 'Refunds',
      topicKey: 'refunds',
      status: 'superseded',
      deletedAt: undefined,
    });

    let code: string | undefined;
    try {
      await handlerOf(updateKnowledgeEntry)(ctx, {
        entryId: 'entry_old',
        topic: 'Refunds',
        content: 'How refunds work.',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_NOT_ACTIVE');
  });

  it('deleteKnowledgeEntry throws UNAUTHENTICATED when there is no auth user', async () => {
    const ctx = createMockCtx(null);
    ctx.auth.getUserIdentity = vi.fn().mockResolvedValue(null);

    let code: string | undefined;
    try {
      await handlerOf(deleteKnowledgeEntry)(ctx, { entryId: 'entry_existing' });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('UNAUTHENTICATED');
  });

  it('deleteKnowledgeEntry throws KNOWLEDGE_ENTRY_NOT_FOUND for a missing entry', async () => {
    const ctx = createMockCtx(null);
    ctx.db.get = vi.fn().mockResolvedValue(null);

    let code: string | undefined;
    try {
      await handlerOf(deleteKnowledgeEntry)(ctx, { entryId: 'entry_missing' });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('KNOWLEDGE_ENTRY_NOT_FOUND');
  });
});
