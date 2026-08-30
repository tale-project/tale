// Coverage for the workspace-tool bridge dispatch — the server side of the
// `tale-connectors-mcp` `workspace_tool`/`workspace_status` face. Uses the
// same handler-extraction pattern as connectors_bridge.test.ts: mock
// `internalAction` to a plain config so `.handler` is directly callable, and
// mock the read primitives (searchKnowledge, org-slug, ctx.runQuery) so the
// bridge's mapping, the read-only surface, the per-dispatch access gate, and
// the audit write are locked without a live embedder or convexTest.

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const searchKnowledgeMock = vi.fn();
vi.mock('../../knowledge/search', () => ({
  searchKnowledge: (...args: unknown[]) => searchKnowledgeMock(...args),
}));
const fetchDocumentMock = vi.fn();
const fetchWebPageMock = vi.fn();
vi.mock('../../knowledge/fetch', async (importOriginal) => {
  // Only the corpus readers are mocked — the window helpers stay real, so
  // the paging the model sees is the paging these tests lock.
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    fetchDocumentByFileId: (...args: unknown[]) => fetchDocumentMock(...args),
    fetchWebPageByUrl: (...args: unknown[]) => fetchWebPageMock(...args),
  };
});
vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** `workspaceToolStatusImpl` needs no ctx — the grant set is the whole
 *  input, so it is called directly rather than through a Handler. */
type StatusFn = (grants: readonly string[]) => Record<string, unknown>;

async function getActions(): Promise<{ dispatch: Handler; status: StatusFn }> {
  // The impls ARE the handlers now — the Convex wrapper that used to carry
  // them retired with the runtime.
  const mod = await import('./workspace_tools_bridge');
  return {
    dispatch: mod.dispatchWorkspaceToolImpl as unknown as Handler,
    status: mod.workspaceToolStatusImpl as unknown as StatusFn,
  };
}

const ACCESS_FN = 'sandbox/workspace_access:resolveWorkspaceReadAccess';
const SCOPE_FN = 'sandbox/workspace_access:resolveKnowledgeToolAccess';
const ACTION_FN = 'sandbox/workspace_access:resolveSessionActionContext';

function fnName(ref: unknown): string {
  return functionRefName(ref);
}

/**
 * A dispatch ctx whose runQuery answers the role-matrix gate from `access`,
 * the knowledge-scope resolution from `scope`, the session-authority
 * resolution (task/document/find tools) from `actionContext`, and every data
 * read from `readQuery` — so tests assert on reads without the gate calls
 * shifting their indices.
 */
type QueryMock = ReturnType<
  typeof vi.fn<(...a: unknown[]) => Promise<unknown>>
>;

function createCtx(
  overrides: {
    access?: Record<string, unknown>;
    scope?: Record<string, unknown>;
    actionContext?: Record<string, unknown>;
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
      overrides.scope ?? {
        allowed: true,
        scope: { teamIds: [], projectIds: [], includeHub: true },
      },
    ),
  );
  const actionContextQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(
      overrides.actionContext ?? {
        allowed: true,
        actorId: 'user_1',
        scope: { kind: 'org' },
      },
    ),
  );
  const runQuery = vi.fn((ref: unknown, args: unknown) => {
    if (fnName(ref) === ACCESS_FN) return accessQuery(ref, args);
    if (fnName(ref) === SCOPE_FN) return scopeQuery(ref, args);
    if (fnName(ref) === ACTION_FN) return actionContextQuery(ref, args);
    return readQuery(ref, args);
  });
  return {
    ctx: {
      runQuery,
      runMutation: overrides.runMutation ?? vi.fn(() => Promise.resolve(null)),
    },
    accessQuery,
    scopeQuery,
    actionContextQuery,
    readQuery,
  };
}

const BASE = {
  organizationId: 'org_1',
  sessionId: 'sid_1',
  userId: 'user_1',
};

describe('dispatchWorkspaceToolImpl', () => {
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

  it('gates every find dispatch on the session authority, with the tool-matching subject', async () => {
    const { dispatch } = await getActions();
    const { ctx, actionContextQuery } = createCtx({
      readQuery: vi.fn(() => Promise.resolve({ page: [], isDone: true })),
    });
    await dispatch(ctx, { ...BASE, tool: 'contact_find', callArgs: {} });
    expect(actionContextQuery).toHaveBeenCalledTimes(1);
    const gateArgs = actionContextQuery.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(gateArgs.organizationId).toBe('org_1');
    expect(gateArgs.sessionId).toBe('sid_1');
    expect(gateArgs.subject).toBe('contacts');
    expect(gateArgs.effect).toBe('read');
  });

  it('a non-member is unavailable (access_denied) and the read never runs', async () => {
    const { dispatch } = await getActions();
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { ctx, readQuery } = createCtx({
      actionContext: { allowed: false, reason: 'not_a_member' },
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
      actionContext: { allowed: false, reason: 'read_denied' },
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
      scope: { allowed: false, reason: 'not_a_member' },
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'anything' },
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'access_denied',
    );
    expect(searchKnowledgeMock).not.toHaveBeenCalled();
  });

  it('a session with neither binding nor user refuses knowledge tools, named', async () => {
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      scope: { allowed: false, reason: 'no_access_context' },
    });
    // No userId at all — a task/automation token shape.
    const result = await dispatch(ctx, {
      organizationId: 'org_1',
      sessionId: 'sid_1',
      tool: 'rag_search',
      callArgs: { query: 'anything' },
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'no_access_context',
    );
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
    const { ctx, scopeQuery } = createCtx({ scope: { allowed: true, scope } });
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
      subject: 'documents',
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

  it('rag_fetch needs a ref', async () => {
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({}).ctx, {
      ...BASE,
      tool: 'rag_fetch',
      callArgs: {},
    });
    expect(result.status).toBe('invalid_args');
    expect(fetchDocumentMock).not.toHaveBeenCalled();
    expect(fetchWebPageMock).not.toHaveBeenCalled();
  });

  it('rag_fetch routes a URL ref to the crawled corpus, websites-subject gated', async () => {
    fetchWebPageMock.mockResolvedValueOnce({
      url: 'https://acme.com/pricing',
      title: 'Pricing',
      lastCrawledAt: 123,
      text: 'per-seat pricing details',
    });
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    const { ctx, scopeQuery } = createCtx({ runMutation });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'rag_fetch',
      callArgs: { ref: 'https://acme.com/pricing' },
    });
    expect(result.status).toBe('ok');
    const output = result.output as Record<string, unknown>;
    expect(output.kind).toBe('web-page');
    expect(output.url).toBe('https://acme.com/pricing');
    // Third-party page content is relayed wrapped, never raw.
    expect(String(output.content)).toContain('per-seat pricing details');
    const resolveArgs = scopeQuery.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(resolveArgs.subject).toBe('websites');
    // The read-set records the page URL for the provenance ledger.
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs.knowledgeRefs).toEqual(['https://acme.com/pricing']);
  });

  it('rag_fetch reads a document by file id, windowed to the fetch budget', async () => {
    fetchDocumentMock.mockResolvedValueOnce({
      fileId: 'file-1',
      filename: 'sop.txt',
      folderPath: null,
      modifiedAt: null,
      text: 'a'.repeat(25_000),
    });
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(
      (ref: unknown) =>
        fnName(ref) === 'file_metadata/internal_queries:lookupVideoLinkSources'
          ? Promise.resolve([])
          : Promise.resolve(null),
    );
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    const { ctx, scopeQuery } = createCtx({ readQuery, runMutation });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'rag_fetch',
      callArgs: { ref: 'file-1' },
    });
    expect(result.status).toBe('ok');
    const output = result.output as Record<string, unknown>;
    expect(output.kind).toBe('document');
    expect(output.filename).toBe('sop.txt');
    expect(output.totalChars).toBe(25_000);
    expect(output.nextOffset).toBe(20_000);
    expect(String(output.content)).toHaveLength(20_000);
    const resolveArgs = scopeQuery.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(resolveArgs.subject).toBe('documents');
    // The fetch runs under the session-resolved scope, never an org-wide one.
    const fetchArgs = fetchDocumentMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(fetchArgs.access).toEqual({
      teamIds: [],
      projectIds: [],
      includeHub: true,
    });
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs.knowledgeRefs).toEqual(['file-1']);
  });

  it('rag_fetch answers a denied or missing document as the same not_found', async () => {
    // The scoped corpus read returns null for denied AND missing alike; the
    // Convex-row fallback finds nothing either.
    fetchDocumentMock.mockResolvedValueOnce(null);
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({}).ctx, {
      ...BASE,
      tool: 'rag_fetch',
      callArgs: { ref: 'file-denied' },
    });
    expect(result.status).toBe('not_found');
  });

  it('rag_fetch serves hub-authored inline content under the same scope rule', async () => {
    fetchDocumentMock.mockResolvedValueOnce(null);
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(
      (ref: unknown) => {
        const name = fnName(ref);
        if (name === 'documents/internal_queries:findDocumentByFileId') {
          return Promise.resolve({ title: 'Note', content: 'inline text' });
        }
        if (name === 'file_metadata/internal_queries:lookupVideoLinkSources') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      },
    );
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({ readQuery }).ctx, {
      ...BASE,
      tool: 'rag_fetch',
      callArgs: { ref: 'file-inline' },
    });
    expect(result.status).toBe('ok');
    const output = result.output as Record<string, unknown>;
    expect(output.content).toBe('inline text');
    expect(output.filename).toBe('Note');
  });

  it('document_find on a BOUND session lists via the binding scope (no userId)', async () => {
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ documents: [{ title: 'q1.pdf' }] }),
    );
    const { dispatch } = await getActions();
    // The default scope mock resolves a binding (allowed), so document_find
    // lists through listDocumentsForScope with the binding's teams+project.
    const result = await dispatch(
      createCtx({
        readQuery,
        scope: {
          allowed: true,
          scope: {
            teamIds: ['team_a'],
            projectIds: ['proj_1'],
            includeHub: true,
          },
        },
      }).ctx,
      { ...BASE, tool: 'document_find', callArgs: { extension: 'pdf' } },
    );
    expect(result.status).toBe('ok');
    const [ref, qArgs] = readQuery.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(fnName(ref)).toBe(
      'documents/internal_queries:listDocumentsForScope',
    );
    expect(qArgs.organizationId).toBe('org_1');
    expect(qArgs.teamIds).toEqual(['team_a']);
    expect(qArgs.projectId).toBe('proj_1');
    // A binding read never carries a user id.
    expect(qArgs.userId).toBeUndefined();
  });

  it('document_find on a USER session (no binding) falls back to the user list', async () => {
    const readQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ page: [{ name: 'q1.pdf' }], isDone: true }),
    );
    const { dispatch } = await getActions();
    const result = await dispatch(
      createCtx({
        readQuery,
        // No binding → the binding-first check refuses, and the dispatch
        // falls back to the turn user's own document scope.
        scope: { allowed: false, reason: 'no_access_context' },
        access: { allowed: true, role: 'member' },
      }).ctx,
      { ...BASE, tool: 'document_find', callArgs: { extension: 'pdf' } },
    );
    expect(result.status).toBe('ok');
    const [ref, qArgs] = readQuery.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(fnName(ref)).toBe('documents/internal_queries:listForAgent');
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

describe('dispatchWorkspaceToolImpl — write tools (task family + document_create)', () => {
  beforeEach(() => vi.clearAllMocks());

  const PROJECT_CTX = {
    allowed: true,
    actorId: 'agent_7',
    scope: { kind: 'project', projectId: 'proj_1' },
  };

  // A MULTI-BOUND automation run org-wide: org scope, but confined to the
  // automation's bound projects. It may act across proj_1/proj_2 and nowhere
  // else — never the whole organization.
  const RESTRICTED_CTX = {
    allowed: true,
    actorId: 'automation:multi',
    scope: { kind: 'org', allowedProjectIds: ['proj_1', 'proj_2'] },
  };

  it('task_create refused when the session has no authority', async () => {
    const { dispatch } = await getActions();
    const { ctx, readQuery } = createCtx({
      actionContext: { allowed: false, reason: 'no_access_context' },
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'Do the thing' },
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'no_access_context',
    );
    // The domain mutation never ran.
    expect(readQuery).not.toHaveBeenCalled();
  });

  it('task_create asks for the effect=write authority and pins the binding project', async () => {
    const runMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_99' }),
    );
    const { dispatch } = await getActions();
    const { ctx, actionContextQuery } = createCtx({
      actionContext: PROJECT_CTX,
      runMutation,
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      // A bound run must NOT be able to redirect the write to another project.
      callArgs: { title: 'Ship it', projectId: 'proj_EVIL' },
    });
    // projectId mismatch on a bound run is refused, not silently rerouted.
    expect(result.status).toBe('invalid_args');
    const gateArgs = actionContextQuery.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(gateArgs.subject).toBe('tasks');
    expect(gateArgs.effect).toBe('write');
  });

  it('task_create creates in the bound project, attributed to the binding actor', async () => {
    const createMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_99' }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: PROJECT_CTX,
      runMutation: vi.fn((ref: unknown, args: unknown) => {
        if (fnName(ref).includes('agentCreateTask'))
          return createMutation(ref, args);
        return Promise.resolve(null);
      }),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'Ship it', priority: 'p1' },
    });
    expect(result.status).toBe('ok');
    expect((result.output as { taskId: string }).taskId).toBe('task_99');
    const mArgs = createMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.organizationId).toBe('org_1');
    expect(mArgs.actorId).toBe('agent_7');
    expect(mArgs.projectId).toBe('proj_1');
    expect(mArgs.title).toBe('Ship it');
    expect(mArgs.priority).toBe('p1');
  });

  it('task_get on a bound run refuses a foreign-project task as not_found', async () => {
    const { dispatch } = await getActions();
    // getTaskByIdInternal (the scope check) resolves a task in another project.
    const readQuery = vi.fn((ref: unknown) =>
      fnName(ref).includes('getTaskByIdInternal')
        ? Promise.resolve({ _id: 'task_x', projectId: 'proj_OTHER' })
        : Promise.resolve(null),
    );
    const { ctx } = createCtx({ actionContext: PROJECT_CTX, readQuery });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_get',
      callArgs: { taskId: 'task_x' },
    });
    expect(result.status).toBe('not_found');
    // The full context read never ran — only the cheap scope point-read.
    expect(
      readQuery.mock.calls.some((c) =>
        fnName(c[0]).includes('getTaskContextForAgent'),
      ),
    ).toBe(false);

    // The refusal is IDENTICAL to a nonexistent task's — no existence oracle
    // that would let a bound run detect a sibling project's task id.
    const { ctx: ctxMissing } = createCtx({
      actionContext: PROJECT_CTX,
      readQuery: vi.fn(() => Promise.resolve(null)),
    });
    const missing = await dispatch(ctxMissing, {
      ...BASE,
      tool: 'task_get',
      callArgs: { taskId: 'task_ghost' },
    });
    expect((result as { message: string }).message).toBe(
      (missing as { message: string }).message,
    );
  });

  it('task_comment on a bound run refuses a foreign-project task', async () => {
    const { dispatch } = await getActions();
    const commentMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ messageId: 'm' }),
    );
    const { ctx } = createCtx({
      actionContext: PROJECT_CTX,
      readQuery: vi.fn((ref: unknown) =>
        fnName(ref).includes('getTaskByIdInternal')
          ? Promise.resolve({ _id: 'task_x', projectId: 'proj_OTHER' })
          : Promise.resolve(null),
      ),
      runMutation: commentMutation,
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_comment',
      callArgs: { taskId: 'task_x', body: 'hi' },
    });
    expect(result.status).toBe('not_found');
    // The comment mutation never ran (only the audit write, if any).
    expect(
      commentMutation.mock.calls.some((c) =>
        fnName(c[0]).includes('agentAddComment'),
      ),
    ).toBe(false);
  });

  it('task_upsert_by_external_ref on a bound run forces dedupeScope=project', async () => {
    const upsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_5', created: false }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: PROJECT_CTX,
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('agentUpsertTaskByExternalRef')
          ? upsert(ref, args)
          : Promise.resolve(null),
      ),
    });
    await dispatch(ctx, {
      ...BASE,
      tool: 'task_upsert_by_external_ref',
      // The caller asks for org scope; a bound run must override to project.
      callArgs: {
        externalSystem: 'github',
        externalId: '7',
        title: 't',
        dedupeScope: 'org',
      },
    });
    const mArgs = upsert.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.dedupeScope).toBe('project');
    expect(mArgs.projectId).toBe('proj_1');
  });

  it('task_update_status relays the domain refusal (agents never set done)', async () => {
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: PROJECT_CTX,
      // The scope point-read resolves an in-project task; the domain mutation
      // then refuses the done transition.
      readQuery: vi.fn((ref: unknown) =>
        fnName(ref).includes('getTaskByIdInternal')
          ? Promise.resolve({ _id: 'task_1', projectId: 'proj_1' })
          : Promise.resolve(null),
      ),
      runMutation: vi.fn(() =>
        Promise.resolve({ ok: false, reason: 'AGENTS_CANNOT_COMPLETE' }),
      ),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_update_status',
      callArgs: { taskId: 'task_1', status: 'done' },
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'AGENTS_CANNOT_COMPLETE',
    );
  });

  it('task_upsert_by_external_ref forwards the idempotency key', async () => {
    const upsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_5', created: true }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: PROJECT_CTX,
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('agentUpsertTaskByExternalRef')
          ? upsert(ref, args)
          : Promise.resolve(null),
      ),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_upsert_by_external_ref',
      callArgs: {
        externalSystem: 'glitchtip',
        externalId: 'issue-42',
        title: 'NPE in checkout',
      },
    });
    expect(result.status).toBe('ok');
    const mArgs = upsert.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.externalSystem).toBe('glitchtip');
    expect(mArgs.externalId).toBe('issue-42');
    expect(mArgs.projectId).toBe('proj_1');
    expect(mArgs.actorId).toBe('agent_7');
  });

  it('task_create on an ORG-level run needs an explicit projectId', async () => {
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: {
        allowed: true,
        actorId: 'automation:x',
        scope: { kind: 'org' },
      },
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'Orphan task' },
    });
    expect(result.status).toBe('invalid_args');
    expect((result as { message: string }).message).toContain('projectId');
  });

  it('task_create on a truly org-level run creates in the project it names', async () => {
    // 0 bindings = whole-org authority: any org project the caller names.
    const createMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_o' }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: {
        allowed: true,
        actorId: 'automation:x',
        scope: { kind: 'org' },
      },
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('agentCreateTask')
          ? createMutation(ref, args)
          : Promise.resolve(null),
      ),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'Cross-project task', projectId: 'proj_named' },
    });
    expect(result.status).toBe('ok');
    const mArgs = createMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.projectId).toBe('proj_named');
    expect(mArgs.actorId).toBe('automation:x');
  });

  it('task_create on a multi-bound org run refuses a project outside the bound set', async () => {
    const create = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'nope' }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: RESTRICTED_CTX,
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('agentCreateTask')
          ? create(ref, args)
          : Promise.resolve(null),
      ),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'Sneak', projectId: 'proj_OUTSIDE' },
    });
    expect(result.status).toBe('invalid_args');
    expect((result as { message: string }).message).toMatch(/bound/);
    // The write never reached the domain: refused at the boundary.
    expect(create).not.toHaveBeenCalled();
  });

  it('task_create on a multi-bound org run creates in a bound project it names', async () => {
    const createMutation = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_b' }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: RESTRICTED_CTX,
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('agentCreateTask')
          ? createMutation(ref, args)
          : Promise.resolve(null),
      ),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'In bounds', projectId: 'proj_2' },
    });
    expect(result.status).toBe('ok');
    const mArgs = createMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.projectId).toBe('proj_2');
    expect(mArgs.actorId).toBe('automation:multi');
  });

  it('task_create on a multi-bound org run needs a projectId and names the bound set', async () => {
    const { dispatch } = await getActions();
    const { ctx } = createCtx({ actionContext: RESTRICTED_CTX });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_create',
      callArgs: { title: 'Which project?' },
    });
    expect(result.status).toBe('invalid_args');
    const message = (result as { message: string }).message;
    expect(message).toContain('proj_1');
    expect(message).toContain('proj_2');
  });

  it('task_find on a multi-bound org run lists only across the bound projects', async () => {
    const list = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve([]),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: RESTRICTED_CTX,
      readQuery: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('listTasksForAgent')
          ? list(ref, args)
          : Promise.resolve(null),
      ),
    });
    await dispatch(ctx, { ...BASE, tool: 'task_find', callArgs: {} });
    const qArgs = list.mock.calls[0]?.[1] as Record<string, unknown>;
    // No single project pins the list, but it is confined to the bound set —
    // never a bare org-wide scan.
    expect(qArgs.projectId).toBeUndefined();
    expect(qArgs.projectIds).toEqual(['proj_1', 'proj_2']);
  });

  it('task_find hands the agent ISO dates, not epoch milliseconds', async () => {
    // The same rendering the chat tools use. An agent asked to reason about
    // "which of these is stale" cannot do epoch arithmetic reliably, so the
    // date arrives already in the format its `Current time:` directive uses.
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      readQuery: vi.fn((ref: unknown) => {
        if (fnName(ref).includes('listTasksForAgent')) {
          return Promise.resolve([
            {
              _id: 'task_1',
              number: 7,
              title: 'Chase the invoice',
              status: 'todo',
              projectId: 'proj_1',
              commentCount: 0,
              createdAt: 1_787_124_301_288,
              updatedAt: 1_787_210_701_288,
            },
          ]);
        }
        if (fnName(ref).includes('getProjectLabelsForOrg')) {
          return Promise.resolve([
            { id: 'proj_1', name: 'Billing', key: 'BILL' },
          ]);
        }
        return Promise.resolve(null);
      }),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_find',
      callArgs: {},
    });
    expect(result.status).toBe('ok');
    const [task] = (result.output as { tasks: Record<string, unknown>[] })
      .tasks;
    expect(task?.createdAt).toBe('2026-08-19T07:25:01.288Z');
    expect(task?.updatedAt).toBe('2026-08-20T07:25:01.288Z');
    expect(task).toMatchObject({
      projectId: 'proj_1',
      project: 'Billing',
      projectKey: 'BILL',
    });
  });

  it('task_get on a multi-bound org run refuses a task outside the bound set', async () => {
    const contextRead = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ task: {}, project: {}, comments: [] }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: RESTRICTED_CTX,
      readQuery: vi.fn((ref: unknown, args: unknown) => {
        if (fnName(ref).includes('getTaskByIdInternal'))
          return Promise.resolve({ _id: 'task_x', projectId: 'proj_OUTSIDE' });
        if (fnName(ref).includes('getTaskContextForAgent'))
          return contextRead(ref, args);
        return Promise.resolve(null);
      }),
    });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_get',
      callArgs: { taskId: 'task_x' },
    });
    expect(result.status).toBe('not_found');
    // The scope point-read refused before the full context read could leak a
    // non-bound project's discussion.
    expect(contextRead).not.toHaveBeenCalled();
  });

  it('task_upsert_by_external_ref on a multi-bound org run forces project-local dedupe', async () => {
    const upsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ taskId: 'task_u', created: false }),
    );
    const { dispatch } = await getActions();
    const { ctx } = createCtx({
      actionContext: RESTRICTED_CTX,
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('agentUpsertTaskByExternalRef')
          ? upsert(ref, args)
          : Promise.resolve(null),
      ),
    });
    // Caller names a bound project and asks for org dedupe; the run overrides to
    // project so the reconcile cannot patch a task on another project's board.
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_upsert_by_external_ref',
      callArgs: {
        externalSystem: 'glitchtip',
        externalId: 'issue-9',
        title: 'Crash',
        projectId: 'proj_1',
        dedupeScope: 'org',
      },
    });
    expect(result.status).toBe('ok');
    const mArgs = upsert.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.dedupeScope).toBe('project');
    expect(mArgs.projectId).toBe('proj_1');
  });

  it('task_upsert_by_external_ref on a multi-bound org run needs a projectId even to update', async () => {
    // Project-local dedupe needs a single project, so an update-only reconcile
    // cannot fall back to an org-wide search that would reach a non-bound board.
    const { dispatch } = await getActions();
    const { ctx } = createCtx({ actionContext: RESTRICTED_CTX });
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'task_upsert_by_external_ref',
      callArgs: {
        externalSystem: 'glitchtip',
        externalId: 'issue-9',
        title: 'Crash',
        createIfMissing: false,
      },
    });
    expect(result.status).toBe('invalid_args');
    expect((result as { message: string }).message).toContain('proj_1');
  });

  it('document_create on a project-bound run files it IN the project and links the blob', async () => {
    const runAction = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ fileStorageId: 'store_1' }),
    );
    const upsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ documentId: 'doc_1', action: 'created' }),
    );
    const link = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(null),
    );
    const { dispatch } = await getActions();
    const runMutation = vi.fn((ref: unknown, args: unknown) => {
      if (fnName(ref).includes('upsertDocumentByExternalId'))
        return upsert(ref, args);
      if (fnName(ref).includes('linkDocumentToFile')) return link(ref, args);
      return Promise.resolve(null);
    });
    const ctx = {
      runQuery: vi.fn((ref: unknown) =>
        fnName(ref) === ACTION_FN
          ? Promise.resolve(PROJECT_CTX)
          : Promise.resolve(null),
      ),
      runMutation,
      runAction,
    };
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'document_create',
      callArgs: { name: 'report.md', content: '# Report\n' },
    });
    expect(result.status).toBe('ok');
    expect((result.output as { documentId: string }).documentId).toBe('doc_1');
    const mArgs = upsert.mock.calls[0]?.[1] as Record<string, unknown>;
    // Scoped to the run's project — NOT the org hub — so other projects' agents
    // cannot see it through baseline rag_search. Key namespaced by project +
    // actor so re-runs are idempotent and never collide across projects.
    expect(mArgs.projectId).toBe('proj_1');
    expect(mArgs.externalItemId).toBe('agent:project:proj_1:agent_7:report.md');
    expect(mArgs.createdBy).toBe('agent_7');
    // The blob is promoted to the document (no temp GC, RAG scheduled).
    const linkArgs = link.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(linkArgs.storageId).toBe('store_1');
    expect(linkArgs.documentId).toBe('doc_1');
  });

  it('document_create on an org-level run writes the hub (no project)', async () => {
    const runAction = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ fileStorageId: 'store_1' }),
    );
    const upsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ documentId: 'doc_h', action: 'created' }),
    );
    const { dispatch } = await getActions();
    const ctx = {
      runQuery: vi.fn((ref: unknown) =>
        fnName(ref) === ACTION_FN
          ? Promise.resolve({
              allowed: true,
              actorId: 'automation:x',
              scope: { kind: 'org' },
            })
          : Promise.resolve(null),
      ),
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('upsertDocumentByExternalId')
          ? upsert(ref, args)
          : Promise.resolve(null),
      ),
      runAction,
    };
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'document_create',
      callArgs: { name: 'report.md', content: '# Report\n' },
    });
    expect(result.status).toBe('ok');
    const mArgs = upsert.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mArgs.projectId).toBeUndefined();
    expect(mArgs.externalItemId).toBe('agent:hub:automation:x:report.md');
  });

  it('document_create on a multi-bound org run refuses a project outside the set', async () => {
    const upsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ documentId: 'nope', action: 'created' }),
    );
    const { dispatch } = await getActions();
    const ctx = {
      runQuery: vi.fn((ref: unknown) =>
        fnName(ref) === ACTION_FN
          ? Promise.resolve(RESTRICTED_CTX)
          : Promise.resolve(null),
      ),
      runMutation: vi.fn((ref: unknown, args: unknown) =>
        fnName(ref).includes('upsertDocumentByExternalId')
          ? upsert(ref, args)
          : Promise.resolve(null),
      ),
      runAction: vi.fn(() => Promise.resolve({ fileStorageId: 'store_1' })),
    };
    const result = await dispatch(ctx, {
      ...BASE,
      tool: 'document_create',
      callArgs: {
        name: 'report.md',
        content: '# Report\n',
        projectId: 'proj_OUTSIDE',
      },
    });
    expect(result.status).toBe('invalid_args');
    // Refused before any blob was stored or document written.
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('workspaceToolStatusImpl', () => {
  it('lists granted tools with descriptions', async () => {
    const { status } = await getActions();
    const result = status(['rag_search', 'knowledge_entry_find']);
    const tools = result.tools as { name: string; description: string }[];
    expect(tools.map((t) => t.name)).toEqual([
      'rag_search',
      'knowledge_entry_find',
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('badges write tools as not read-only and reads as read-only', async () => {
    const { status } = await getActions();
    const result = status(['task_find', 'task_create', 'document_create']);
    const tools = result.tools as { name: string; readOnly: boolean }[];
    const byName = new Map(tools.map((t) => [t.name, t.readOnly]));
    expect(byName.get('task_find')).toBe(true);
    expect(byName.get('task_create')).toBe(false);
    expect(byName.get('document_create')).toBe(false);
  });

  it('says plainly when nothing is granted', async () => {
    const { status } = await getActions();
    const result = status([]);
    expect(result.tools).toEqual([]);
    expect(String(result.note)).toContain('No workspace tools');
  });
});
