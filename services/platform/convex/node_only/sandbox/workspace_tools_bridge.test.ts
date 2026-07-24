// Coverage for the workspace-tool bridge dispatch — the server side of the
// `tale-integrations-mcp` `workspace_tool`/`workspace_status` face. Uses the
// same handler-extraction pattern as integrations_bridge.test.ts: mock
// `internalAction` to a plain config so `.handler` is directly callable, and
// mock the read primitives (searchKnowledge, org-slug, ctx.runQuery) so the
// bridge's mapping, the read-only surface, and the audit write are locked
// without a live embedder or convexTest.

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

function createCtx(overrides: {
  runQuery?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
}) {
  return {
    runQuery: overrides.runQuery ?? vi.fn(),
    runMutation: overrides.runMutation ?? vi.fn(() => Promise.resolve(null)),
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
    const result = await dispatch(createCtx({ runMutation }), {
      ...BASE,
      tool: 'delete_everything',
      callArgs: {},
    });
    expect(result.status).toBe('invalid_args');
    // Audited: a recordToolCall mutation with the outcome + tool.
    expect(runMutation).toHaveBeenCalledTimes(1);
    const auditArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs.tool).toBe('delete_everything');
    expect(auditArgs.outcome).toBe('invalid_args');
    expect(auditArgs.sessionId).toBe('sid_1');
  });

  it('rag_search needs a query', async () => {
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({}), {
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
    const result = await dispatch(createCtx({}), {
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
    const result = await dispatch(createCtx({}), {
      ...BASE,
      tool: 'rag_search',
      callArgs: { query: 'anything' },
    });
    expect(result.status).toBe('unavailable');
    expect((result.blockers as { code: string }[])[0]?.code).toBe(
      'knowledge_unavailable',
    );
  });

  it('document_find lists the org+user-scoped documents', async () => {
    const runQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve({ page: [{ name: 'q1.pdf' }], isDone: true }),
    );
    const { dispatch } = await getActions();
    const result = await dispatch(createCtx({ runQuery }), {
      ...BASE,
      tool: 'document_find',
      callArgs: { extension: 'pdf' },
    });
    expect(result.status).toBe('ok');
    // Scoped to the turn's org + user (never the request body).
    const qArgs = runQuery.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(qArgs.organizationId).toBe('org_1');
    expect(qArgs.userId).toBe('user_1');
  });

  it.each([
    ['contact_find', { searchTerm: 'acme' }],
    ['product_find', {}],
    ['website_find', {}],
  ])(
    '%s reads org-scoped data (never a body-supplied org)',
    async (tool, callArgs) => {
      const runQuery = vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
        Promise.resolve({ page: [], isDone: true }),
      );
      const { dispatch } = await getActions();
      const result = await dispatch(createCtx({ runQuery }), {
        ...BASE,
        tool,
        // Try to smuggle another org — must be ignored (org comes from the token).
        callArgs: { ...callArgs, organizationId: 'org_EVIL' },
      });
      expect(result.status).toBe('ok');
      const qArgs = runQuery.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(qArgs.organizationId).toBe('org_1');
    },
  );
});

describe('workspaceToolStatus', () => {
  it('lists granted tools with descriptions', async () => {
    const { status } = await getActions();
    const result = await status(createCtx({}), {
      grants: ['rag_search', 'document_find'],
    });
    const tools = result.tools as { name: string; readOnly: boolean }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      'document_find',
      'rag_search',
    ]);
    expect(tools.every((t) => t.readOnly)).toBe(true);
  });

  it('says plainly when nothing is granted', async () => {
    const { status } = await getActions();
    const result = await status(createCtx({}), { grants: [] });
    expect(result.tools).toEqual([]);
    expect(typeof result.note).toBe('string');
  });
});
