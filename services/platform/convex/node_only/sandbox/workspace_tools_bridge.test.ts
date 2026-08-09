// Coverage for the workspace-tool bridge dispatch — the server side of the
// `tale-connectors-mcp` `workspace_tool`/`workspace_status` face. Uses the
// same handler-extraction pattern as connectors_bridge.test.ts: mock
// `internalAction` to a plain config so `.handler` is directly callable, and
// mock the read primitives (searchKnowledge, org-slug, ctx.runQuery) so the
// bridge's mapping, the read-only surface, the per-dispatch access gate, and
// the audit write are locked without a live embedder or convexTest.

import { getFunctionName } from 'convex/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

const searchKnowledgeMock = vi.fn();
vi.mock('../../knowledge/search', () => ({
  searchKnowledge: (...args: unknown[]) => searchKnowledgeMock(...args),
}));
vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function getActions(): Promise<{ dispatch: Handler; status: Handler }> {
  const mod = await import('./workspace_tools_bridge');
  return {
    dispatch: (mod.dispatchWorkspaceTool as unknown as { handler: Handler })
      .handler,
    status: (mod.workspaceToolStatus as unknown as { handler: Handler })
      .handler,
  };
}

const ACCESS_FN = 'sandbox/workspace_access:resolveWorkspaceReadAccess';
const SCOPE_FN = 'sandbox/workspace_access:resolveWorkspaceKnowledgeScope';

function fnName(ref: unknown): string {
  return getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
}

/**
 * A dispatch ctx whose runQuery answers the access gate from `access`, the
 * knowledge-scope resolution from `scope`, and every data read from
 * `readQuery` — so tests assert on reads without the gate calls shifting
 * their indices.
 */
type QueryMock = ReturnType<
  typeof vi.fn<(...a: unknown[]) => Promise<unknown>>
>;

function createCtx(
  overrides: {
    access?: Record<string, unknown>;
    scope?: Record<string, unknown>;
    readQuery?: QueryMock;
    runMutation?: QueryMock;
  } = {},
) {
  const readQuery =
    overrides.readQuery ??
    vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve(null));
  const accessQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(overrides.access ?? { allowed: true, role: 'member' }),
  );
  const scopeQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(
      overrides.scope ?? { teamIds: [], projectIds: [], includeHub: true },
    ),
  );
  const runQuery = vi.fn((ref: unknown, args: unknown) => {
    if (fnName(ref) === ACCESS_FN) return accessQuery(ref, args);
    if (fnName(ref) === SCOPE_FN) return scopeQuery(ref, args);
    return readQuery(ref, args);
  });
  return {
    ctx: {
      runQuery,
      runMutation: overrides.runMutation ?? vi.fn(() => Promise.resolve(null)),
    },
    accessQuery,
    scopeQuery,
    readQuery,
  };
}

const BASE = {
  organizationId: 'org_1',
  sessionId: 'sid_1',
  userId: 'user_1',
};

describe('dispatchWorkspaceTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an unknown tool with invalid_args and audits it', async () => {
    const { dispatch } = await getActions();
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { ctx, accessQuery } = createCtx({ runMutation });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'delete_everything',
      callArgs: {},
    });
    expect(result.status).toBe('invalid_args');
    // Refused before the gate — no membership read for a tool that can't run.
    expect(accessQuery).not.toHaveBeenCalled();
    // Audited: a recordToolCall mutation with the outcome + tool.
    expect(runMutation).toHaveBeenCalledTimes(1);
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs.tool).toBe('delete_everything');
    expect(auditArgs.outcome).toBe('invalid_args');
    expect(auditArgs.sessionId).toBe('sid_1');
  });

  it('gates every dispatch on the turn user, with the tool-matching subject', async () => {
    const { dispatch } = await getActions();
    const { ctx, accessQuery } = createCtx({
      readQuery: vi.fn(() => Promise.resolve({ page: [], isDone: true })),
    });
    await dispatch(ctx, { ...BASE, tool: 'contact_find', callArgs: {} });
    expect(accessQuery).toHaveBeenCalledTimes(1);
    const gateArgs = accessQuery.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(gateArgs.organizationId).toBe('org_1');
    expect(gateArgs.userId).toBe('user_1');
    expect(gateArgs.subject).toBe('contacts');
  });

  it('a non-member is unavailable (access_denied) and the read never runs', async () => {
    const { dispatch } = await getActions();
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { ctx, readQuery } = createCtx({
      access: { allowed: false, reason: 'not_a_member' },
      runMutation,
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'contact_find',
      callArgs: {},
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'access_denied',
    );
    expect(readQuery).not.toHaveBeenCalled();
    // The refusal is audited like any other outcome.
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs.outcome).toBe('unavailable');
  });

  it('a role without read on the subject is refused with the subject named', async () => {
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      access: { allowed: false, reason: 'read_denied' },
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'product_find',
      callArgs: {},
    });
    expect(result.status).toBe('unavailable');
    const blocker = (
      result.blockers as { code: string; guidance: string }[]
    )[0];
    expect(blocker?.code).toBe('access_denied');
    expect(blocker?.guidance).toContain('products');
  });

  it('rag_search is gated too — denied means no retrieval at all', async () => {
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      access: { allowed: false, reason: 'not_a_member' },
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'anything' },
    });
    expect(result.status).toBe('unavailable');
    expect(searchKnowledgeMock).not.toHaveBeenCalled();
  });

  it('rag_search needs a query', async () => {
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({}).ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: {},
    });
    expect(result.status).toBe('invalid_args');
    expect(searchKnowledgeMock).not.toHaveBeenCalled();
  });

  it('rag_search returns ok with the retrieved knowledge', async () => {
    searchKnowledgeMock.mockResolvedValueOnce({ passages: ['a', 'b'] });
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({}).ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'how do refunds work' },
    });
    expect(result.status).toBe('ok');
    expect(result.output).toEqual({ passages: ['a', 'b'] });
    // Ran for the caller's org (slug resolved), never a default corpus.
    const call = searchKnowledgeMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(call.organizationId).toBe('org_1');
    expect(call.orgSlug).toBe('acme');
  });

  it('rag_search reports unavailable (not a throw) when knowledge is unconfigured', async () => {
    searchKnowledgeMock.mockRejectedValueOnce(
      new Error('no embedding model configured'),
    );
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({}).ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'anything' },
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'knowledge_unavailable',
    );
  });

  it('rag_search carries the SESSION-derived access scope, never a body one', async () => {
    searchKnowledgeMock.mockResolvedValueOnce({ hits: [] });
    const scope = {
      teamIds: ['team-a'],
      projectIds: ['proj-1'],
      includeHub: true,
    };
    const { dispatch } = await getActions();
    const { ctx, scopeQuery } = createCtx({ scope });
    await dispatch(ctx, {
      ...BASE,
      tool: 'rag_search',
      // Smuggled scope must be ignored: access derives from the token's
      // session + user, resolved server-side.
      callArgs: { query: 'refunds', access: { teamIds: ['team-EVIL'] } },
    });
    const resolveArgs = scopeQuery.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(resolveArgs).toEqual({
      organizationId: 'org_1',
      sessionId: 'sid_1',
      userId: 'user_1',
    });
    const call = searchKnowledgeMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(call.access).toEqual(scope);
  });

  it('records the read-set: distinct hit refs, order kept, capped at 20', async () => {
    const hits = Array.from({ length: 25 }, (_v, i) => ({
      source: { ref: `doc-${i}` },
    }));
    // A duplicate early ref must not repeat or consume cap slots twice.
    hits.splice(1, 0, { source: { ref: 'doc-0' } });
    searchKnowledgeMock.mockResolvedValueOnce({ hits });
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    await dispatch(createCtx({ runMutation }).ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'refunds' },
    });
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    const refs = auditArgs.knowledgeRefs as string[];
    expect(refs).toHaveLength(20);
    expect(refs[0]).toBe('doc-0');
    expect(refs[1]).toBe('doc-1');
    expect(new Set(refs).size).toBe(20);
  });

  it('pins the audit row to the turn: the token-row VK id rides to recordToolCall', async () => {
    searchKnowledgeMock.mockResolvedValueOnce({ hits: [] });
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    await dispatch(createCtx({ runMutation }).ctx, {
      ...BASE,
      mintedKeyId: 'vk-turn-1',
      tool: 'rag_search',
      callArgs: { query: 'refunds' },
    });
    const [ref, auditArgs] = runMutation.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(fnName(ref)).toBe('sandbox/session_mutations:recordToolCall');
    expect(auditArgs.mintedKeyId).toBe('vk-turn-1');
  });

  it('leaves mintedKeyId absent when the token was minted without a gateway key', async () => {
    searchKnowledgeMock.mockResolvedValueOnce({ hits: [] });
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    await dispatch(createCtx({ runMutation }).ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'refunds' },
    });
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('mintedKeyId' in auditArgs).toBe(false);
  });

  it('leaves knowledgeRefs absent for non-RAG tools and failed searches', async () => {
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    await dispatch(
      createCtx({
        runMutation,
        readQuery: vi.fn(() => Promise.resolve({ page: [], isDone: true })),
      }).ctx,
      { ...BASE, tool: 'contact_find', callArgs: {} },
    );
    searchKnowledgeMock.mockRejectedValueOnce(new Error('unconfigured'));
    await dispatch(createCtx({ runMutation }).ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'anything' },
    });
    for (const call of runMutation.mock.calls) {
      const auditArgs = call[1] as Record<string, unknown>;
      expect('knowledgeRefs' in auditArgs).toBe(false);
    }
  });

  it('document_find lists the org+user-scoped documents', async () => {
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ page: [{ name: 'q1.pdf' }], isDone: true }),
    );
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({ readQuery }).ctx, {
      ...BASE,
      tool: 'document_find',
      callArgs: { extension: 'pdf' },
    });
    expect(result.status).toBe('ok');
    // Scoped to the turn's org + user (never the request body).
    const qArgs = readQuery.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(qArgs.organizationId).toBe('org_1');
    expect(qArgs.userId).toBe('user_1');
  });

  it('knowledge_entry_find lists active entries with topic filter and cursor', async () => {
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ page: [{ topic: 'Refunds' }], isDone: true }),
    );
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({ readQuery }).ctx, {
      ...BASE,
      tool: 'knowledge_entry_find',
      callArgs: { topic: 'refund', cursor: 'entry_9', limit: 5 },
    });
    expect(result.status).toBe('ok');
    const [ref, qArgs] = readQuery.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(fnName(ref)).toBe(
      'knowledge_entries/internal_queries:listEntriesForAgent',
    );
    expect(qArgs.organizationId).toBe('org_1');
    expect(qArgs.topic).toBe('refund');
    expect(qArgs.paginationOpts).toEqual({ numItems: 5, cursor: 'entry_9' });
  });

  it('contact_find pages with the caller-supplied cursor', async () => {
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ page: [], isDone: false, continueCursor: 'c2' }),
    );
    const { dispatch } = await getActions();
    await dispatch(createCtx({ readQuery }).ctx, {
      ...BASE,
      tool: 'contact_find',
      callArgs: { searchTerm: 'acme', cursor: 'c1' },
    });
    const qArgs = readQuery.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(qArgs.searchTerm).toBe('acme');
    expect(qArgs.paginationOpts).toEqual({ numItems: 20, cursor: 'c1' });
  });

  it('product_find searches and pages (queryProducts, not a bare list)', async () => {
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ page: [], isDone: true, continueCursor: '' }),
    );
    const { dispatch } = await getActions();
    await dispatch(createCtx({ readQuery }).ctx, {
      ...BASE,
      tool: 'product_find',
      callArgs: { searchTerm: 'blue', cursor: 'p1', limit: 10 },
    });
    const [ref, qArgs] = readQuery.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(fnName(ref)).toBe('products/internal_queries:queryProducts');
    expect(qArgs.searchTerm).toBe('blue');
    expect(qArgs.paginationOpts).toEqual({ numItems: 10, cursor: 'p1' });
  });

  it.each([
    ['contact_find', { searchTerm: 'acme' }],
    ['product_find', {}],
    ['website_find', {}],
    ['knowledge_entry_find', {}],
  ])(
    '%s reads org-scoped data (never a body-supplied org)',
    async (tool, callArgs) => {
      const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
        Promise.resolve({ page: [], isDone: true }),
      );
      const { dispatch } = await getActions();
      const result = await dispatch(createCtx({ readQuery }).ctx, {
        ...BASE,
        tool,
        // Try to smuggle another org — must be ignored (org comes from the token).
        callArgs: { ...callArgs, organizationId: 'org_EVIL' },
      });
      expect(result.status).toBe('ok');
      const qArgs = readQuery.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(qArgs.organizationId).toBe('org_1');
    },
  );
});

describe('workspaceToolStatus', () => {
  it('lists granted tools with descriptions', async () => {
    const { status } = await getActions();
    const result = await status(
      {},
      { grants: ['rag_search', 'knowledge_entry_find'] },
    );
    const tools = result.tools as { name: string; description: string }[];
    expect(tools.map((t) => t.name)).toEqual([
      'rag_search',
      'knowledge_entry_find',
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('says plainly when nothing is granted', async () => {
    const { status } = await getActions();
    const result = await status({}, { grants: [] });
    expect(result.tools).toEqual([]);
    expect(String(result.note)).toContain('No workspace tools');
  });
});
