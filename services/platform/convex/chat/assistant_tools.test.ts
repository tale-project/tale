// Coverage for the chat assistant's three-tool executor — the Convex side of
// `lib/chat/tools.ts`. Uses the same pattern as the workspace bridge test
// (`node_only/sandbox/workspace_tools_bridge.test.ts`): mock the read
// primitives (searchKnowledge, the corpus fetchers, org-slug, safeFetch) and
// drive the executor with a fake ctx whose runQuery dispatches on the function
// reference — so the mapping, the per-dispatch access gate, the honest empty
// cases, and the audit/usage bookkeeping are locked without a live embedder,
// database, or network. The executor's contract is that `execute` NEVER
// rejects, so every failure case here asserts through `.resolves`.

import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_ASSISTANT_SLUG } from '../../lib/chat';
import { SafeFetchError } from '../lib/http/safe_fetch';

const searchKnowledgeMock = vi.fn();
vi.mock('../knowledge/search', () => ({
  searchKnowledge: (...args: unknown[]) => searchKnowledgeMock(...args),
}));

const fetchDocumentByFileIdMock = vi.fn();
const fetchWebPageByUrlMock = vi.fn();
vi.mock('../knowledge/fetch', () => ({
  fetchDocumentByFileId: (...args: unknown[]) =>
    fetchDocumentByFileIdMock(...args),
  fetchWebPageByUrl: (...args: unknown[]) => fetchWebPageByUrlMock(...args),
}));

vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('org-slug'),
}));

// `safeFetch` is the only network edge; `isPrivateIp` and `SafeFetchError`
// stay real so the URL policy under test is the shipped one.
const safeFetchMock = vi.fn();
vi.mock('../lib/http/safe_fetch', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  };
});

/** What every tool answers with — loosely typed for assertions. */
interface ToolResult {
  status?: string;
  message?: string;
  query?: string;
  results?: Array<Record<string, unknown>>;
  sources?: Record<string, string>;
  kind?: string;
  ref?: string;
  url?: string;
  title?: string;
  filename?: string;
  content?: string;
  totalChars?: number;
  offset?: number;
  nextOffset?: number;
  truncatedAt?: number;
}

interface Executor {
  wireTools: readonly { name: string }[];
  execute(call: {
    id: string;
    name: string;
    input: unknown;
    rawInput?: string;
  }): Promise<ToolResult>;
}

type ExecutorFactory = (
  ctx: unknown,
  who: { organizationId: string; userId: string },
) => Executor;

async function getFactory(): Promise<ExecutorFactory> {
  const mod = await import('./assistant_tools');
  return mod.createChatToolExecutor as unknown as ExecutorFactory;
}

function fnName(ref: unknown): string {
  return getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
}

const ACCESS_FN = 'sandbox/workspace_access:resolveWorkspaceReadAccess';
const KNOWLEDGE_SCOPE_FN = 'documents/internal_queries:resolveKnowledgeAccess';
const AUDIT_FN = 'audit_logs/internal_mutations:createAuditLog';
const USAGE_FN = 'governance/internal_mutations:recordConnectorUsage';
const ENTRIES_FN = 'knowledge_entries/internal_queries:listEntriesForAgent';
const CONTACTS_FN = 'contacts/internal_queries:queryContacts';
const PRODUCTS_FN = 'products/internal_queries:queryProducts';
const WEBSITES_FN = 'websites/internal_queries:listWebsiteSummaries';
const DOCUMENT_ROW_FN = 'documents/internal_queries:findDocumentByFileId';
const VIDEO_SOURCES_FN =
  'file_metadata/internal_queries:lookupVideoLinkSources';

const WHO = { organizationId: 'org_1', userId: 'user_1' };

type QueryMock = ReturnType<
  typeof vi.fn<(...a: unknown[]) => Promise<unknown>>
>;

/**
 * A dispatch ctx: runQuery answers the access gate from `access` (per
 * subject) and every entity read from the fixture for its function name;
 * runMutation records the audit/usage bookkeeping.
 */
function createCtx(
  overrides: {
    access?: (subject: string) => Record<string, unknown>;
    reads?: Record<string, (args: Record<string, unknown>) => unknown>;
  } = {},
) {
  const access =
    overrides.access ?? (() => ({ allowed: true, role: 'member' }));
  const reads: Record<string, (args: Record<string, unknown>) => unknown> = {
    [ENTRIES_FN]: () => ({ page: [], isDone: true, continueCursor: '' }),
    [CONTACTS_FN]: () => ({ page: [], isDone: true, continueCursor: '' }),
    [PRODUCTS_FN]: () => ({ page: [], isDone: true, continueCursor: '' }),
    [WEBSITES_FN]: () => [],
    [DOCUMENT_ROW_FN]: () => null,
    [VIDEO_SOURCES_FN]: () => [],
    [KNOWLEDGE_SCOPE_FN]: () => ({
      teamIds: [`org_${WHO.organizationId}`],
      projectIds: [],
      includeHub: true,
    }),
    ...overrides.reads,
  };
  const runQuery: QueryMock = vi.fn((ref: unknown, args: unknown) => {
    const name = fnName(ref);
    const queryArgs = args as Record<string, unknown>;
    if (name === ACCESS_FN) {
      return Promise.resolve(access(String(queryArgs.subject)));
    }
    const read = reads[name];
    if (!read) {
      return Promise.reject(new Error(`unexpected query in test: ${name}`));
    }
    return Promise.resolve(read(queryArgs));
  });
  const runMutation: QueryMock = vi.fn(() => Promise.resolve(null));
  return { ctx: { runQuery, runMutation }, runQuery, runMutation };
}

/** The recorded args of every runMutation call to one function. */
function callsTo(mock: QueryMock, fn: string): Record<string, unknown>[] {
  return mock.mock.calls
    .filter(([ref]) => fnName(ref) === fn)
    .map(([, args]) => args as Record<string, unknown>);
}

async function makeExecutor(ctx: unknown): Promise<Executor> {
  return (await getFactory())(ctx, WHO);
}

describe('createChatToolExecutor — dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes exactly the fixed three-tool loadout on the wire', async () => {
    const executor = await makeExecutor(createCtx().ctx);
    expect(executor.wireTools.map((tool) => tool.name)).toEqual([
      'rag_search',
      'rag_fetch',
      'web_fetch',
    ]);
  });

  it('answers unparseable arguments with invalid_args naming JSON — never a throw', async () => {
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'rag_search',
        input: {},
        rawInput: '{"query": broken',
      }),
    ).resolves.toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining('JSON'),
    });
    expect(searchKnowledgeMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown tool, listing the three that exist', async () => {
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({ id: 'call_1', name: 'delete_everything', input: {} }),
    ).resolves.toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining('rag_search, rag_fetch, web_fetch'),
    });
  });
});

describe('rag_search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fuses every leg into mapped kinds, notes each source, and records the dispatch once', async () => {
    searchKnowledgeMock.mockResolvedValueOnce({
      hits: [
        {
          id: '1',
          corpus: 'documents',
          text: 'Acme refunds within 30 days.',
          chunkIndex: 0,
          score: 0.9,
          fusedScore: 0.9,
          source: { ref: 'file_123', title: 'Handbook', url: null },
        },
        {
          id: '2',
          corpus: 'web',
          text: 'Acme pricing overview.',
          chunkIndex: 0,
          score: 0.8,
          fusedScore: 0.8,
          source: {
            ref: 'https://acme.com/pricing',
            title: 'Pricing',
            url: 'https://acme.com/pricing',
          },
        },
      ],
      diagnostics: {},
    });
    const { ctx, runMutation } = createCtx({
      reads: {
        [ENTRIES_FN]: () => ({
          page: [{ topic: 'Acme onboarding', content: 'Steps to onboard.' }],
          isDone: true,
        }),
        [CONTACTS_FN]: () => ({
          page: [
            {
              name: 'Ada Acme',
              email: 'ada@acme.com',
              phone: '+1 555',
              tags: ['vip'],
            },
          ],
          isDone: true,
        }),
        [PRODUCTS_FN]: () => ({
          page: [
            { name: 'Acme Widget', category: 'Tools', price: 19, stock: 3 },
          ],
          isDone: true,
        }),
        [WEBSITES_FN]: () => [
          {
            domain: 'acme.com',
            title: 'Acme',
            description: 'Acme corporate site',
          },
        ],
      },
    });
    const executor = await makeExecutor(ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_search',
      input: { query: 'acme' },
    });

    expect(result.status).toBe('ok');
    expect(result.results?.map((entry) => entry.kind)).toEqual([
      'document',
      'web-page',
      'knowledge-entry',
      'contact',
      'product',
      'website',
    ]);
    // The corpus hit carries the ref rag_fetch accepts; the page its URL.
    expect(result.results?.[0]?.ref).toBe('file_123');
    expect(result.results?.[1]?.url).toBe('https://acme.com/pricing');
    expect(result.sources).toEqual({
      documents: 'searched',
      webPages: 'searched',
      knowledgeEntries: 'searched',
      contacts: 'searched',
      products: 'searched',
      websites: 'searched',
    });
    // Ran for the turn's org (slug resolved), never a default corpus.
    const searchArgs = searchKnowledgeMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(searchArgs.organizationId).toBe('org_1');
    expect(searchArgs.orgSlug).toBe('org-slug');
    // …and under the turn USER's visibility, resolved server-side — never
    // org-wide, never anything the model's arguments could shape.
    expect(searchArgs.access).toEqual({
      teamIds: ['org_org_1'],
      projectIds: [],
      includeHub: true,
    });
    // One audit row and one usage-ledger row per dispatch.
    const audits = callsTo(runMutation, AUDIT_FN);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: 'org_1',
      actorId: 'user_1',
      action: 'chat.tool.rag_search',
      status: 'success',
    });
    const usages = callsTo(runMutation, USAGE_FN);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      agentSlug: CHAT_ASSISTANT_SLUG,
      connectorName: 'chat-tools',
      connectorOperation: 'rag_search',
    });
  });

  it('says the corpora are unavailable when knowledge search fails — other legs still answer', async () => {
    searchKnowledgeMock.mockRejectedValueOnce(
      new Error('No embedding model is configured for this organization'),
    );
    const { ctx } = createCtx({
      reads: {
        [CONTACTS_FN]: () => ({
          page: [{ name: 'Ada Acme' }],
          isDone: true,
        }),
      },
    });
    const executor = await makeExecutor(ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_search',
      input: { query: 'acme' },
    });

    expect(result.status).toBe('ok');
    expect(result.sources?.documents).toMatch(/^unavailable:/);
    expect(result.sources?.documents).toContain('No embedding model');
    expect(result.sources?.webPages).toBe(result.sources?.documents);
    // The degradation is per source, never the whole answer.
    expect(result.sources?.knowledgeEntries).toBe('searched (no matches)');
    expect(result.sources?.contacts).toBe('searched');
    expect(result.results?.map((entry) => entry.kind)).toEqual(['contact']);
  });

  it('reads a denied subject as denied, without running its query', async () => {
    searchKnowledgeMock.mockResolvedValueOnce({ hits: [], diagnostics: {} });
    const { ctx, runQuery } = createCtx({
      access: (subject) =>
        subject === 'contacts'
          ? { allowed: false, reason: 'read_denied' }
          : { allowed: true, role: 'member' },
    });
    const executor = await makeExecutor(ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_search',
      input: { query: 'acme' },
    });

    expect(result.status).toBe('ok');
    expect(result.sources?.contacts).toContain('access denied');
    expect(result.results?.some((entry) => entry.kind === 'contact')).toBe(
      false,
    );
    const contactReads = runQuery.mock.calls.filter(
      ([ref]) => fnName(ref) === CONTACTS_FN,
    );
    expect(contactReads).toHaveLength(0);
  });

  it('needs a non-empty query', async () => {
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({ id: 'call_1', name: 'rag_search', input: {} }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
    await expect(
      executor.execute({
        id: 'call_2',
        name: 'rag_search',
        input: { query: '   ' },
      }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
    expect(searchKnowledgeMock).not.toHaveBeenCalled();
  });
});

describe('rag_fetch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads a crawled page by URL, wrapped as untrusted content', async () => {
    fetchWebPageByUrlMock.mockResolvedValueOnce({
      url: 'https://ex.com/page',
      title: 'Example page',
      lastCrawledAt: 1_234,
      text: 'Hello crawled page text.',
    });
    const executor = await makeExecutor(createCtx().ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'https://ex.com/page' },
    });

    expect(result.status).toBe('ok');
    expect(result.kind).toBe('web-page');
    expect(result.url).toBe('https://ex.com/page');
    expect(result.title).toBe('Example page');
    expect(result.totalChars).toBe('Hello crawled page text.'.length);
    expect(result.offset).toBe(0);
    expect(result.nextOffset).toBeUndefined();
    // Crawled page text is third-party content — it reads wrapped.
    expect(result.content).toContain('<untrusted_source');
    expect(result.content).toContain('url="https://ex.com/page"');
    expect(result.content).toContain('Hello crawled page text.');
    // The corpus was addressed through the resolved org slug.
    expect(fetchWebPageByUrlMock).toHaveBeenCalledWith(
      'org-slug',
      'https://ex.com/page',
    );
  });

  it('answers a URL the corpus does not know with not_found, pointing at web_fetch', async () => {
    fetchWebPageByUrlMock.mockResolvedValueOnce(null);
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'rag_fetch',
        input: { ref: 'https://ex.com/unknown' },
      }),
    ).resolves.toMatchObject({
      status: 'not_found',
      message: expect.stringContaining('web_fetch'),
    });
  });

  it('loads a document from the corpus, NOT untrusted-wrapped', async () => {
    fetchDocumentByFileIdMock.mockResolvedValueOnce({
      fileId: 'file_1',
      filename: 'handbook.pdf',
      folderPath: '/hr',
      modifiedAt: null,
      text: 'Chapter one.',
    });
    const executor = await makeExecutor(createCtx().ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'file_1' },
    });

    expect(result.status).toBe('ok');
    expect(result.kind).toBe('document');
    expect(result.ref).toBe('file_1');
    expect(result.filename).toBe('handbook.pdf');
    // Org-owned document text is first-party: served verbatim, no wrapper.
    expect(result.content).toBe('Chapter one.');
    // The fetch carries the turn USER's visibility, resolved server-side —
    // the same scope the search legs enforce, so a ref in hand is never a
    // capability.
    expect(fetchDocumentByFileIdMock).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      orgSlug: 'org-slug',
      fileId: 'file_1',
      access: {
        teamIds: ['org_org_1'],
        projectIds: [],
        includeHub: true,
      },
    });
  });

  it('falls back to the Convex row when the corpus has no text', async () => {
    fetchDocumentByFileIdMock.mockResolvedValueOnce(null);
    const { ctx, runQuery } = createCtx({
      reads: {
        [DOCUMENT_ROW_FN]: () => ({
          content: 'Inline body from the hub.',
          title: 'Meeting notes',
        }),
      },
    });
    const executor = await makeExecutor(ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'file_2' },
    });

    expect(result.status).toBe('ok');
    expect(result.content).toBe('Inline body from the hub.');
    expect(result.filename).toBe('Meeting notes');
    const rowReads = runQuery.mock.calls.filter(
      ([ref]) => fnName(ref) === DOCUMENT_ROW_FN,
    );
    expect(rowReads).toHaveLength(1);
  });

  it('serves a fallback row whose team the caller belongs to', async () => {
    // The default scope fixture lists team `org_org_1` — a row stamped with
    // it passes the same visibility rule the hub row does.
    fetchDocumentByFileIdMock.mockResolvedValueOnce(null);
    const { ctx } = createCtx({
      reads: {
        [DOCUMENT_ROW_FN]: () => ({
          content: 'Team library body.',
          title: 'Team notes',
          teamId: 'org_org_1',
        }),
      },
    });
    const executor = await makeExecutor(ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'rag_fetch',
        input: { ref: 'file_team' },
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      content: 'Team library body.',
    });
  });

  it('serves a fallback row shared to SEVERAL teams when the caller is on any of them', async () => {
    // Multi-team sharing stamps the caller's team second (`teamTags`); the
    // single-`teamId` check used to hide exactly this row from retrieval
    // while the library listed it.
    fetchDocumentByFileIdMock.mockResolvedValueOnce(null);
    const { ctx } = createCtx({
      reads: {
        [DOCUMENT_ROW_FN]: () => ({
          content: 'Shared library body.',
          title: 'Shared notes',
          teamId: 'team-OTHER',
          teamTags: ['team-OTHER', 'org_org_1'],
        }),
      },
    });
    const executor = await makeExecutor(ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'rag_fetch',
        input: { ref: 'file_shared' },
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      content: 'Shared library body.',
    });
  });

  it('answers an out-of-scope row EXACTLY like a missing one — existence never leaks', async () => {
    // Three refs through one executor: one has no Convex row at all, the
    // others carry inline bodies owned by teams the caller is not on (single
    // stamp and multi-team alike). A holder of a leaked/guessed ref must not
    // be able to tell any of them apart.
    fetchDocumentByFileIdMock.mockResolvedValue(null);
    const rows: Record<string, unknown> = {
      file_foreign: {
        content: 'Team-private inline body.',
        title: 'Q3 plan',
        teamId: 'team-OTHER',
      },
      file_foreign_shared: {
        content: 'Two-team-private inline body.',
        title: 'Q4 plan',
        teamId: 'team-OTHER',
        teamTags: ['team-OTHER', 'team-THIRD'],
      },
    };
    const { ctx } = createCtx({
      reads: {
        [DOCUMENT_ROW_FN]: (args) => rows[String(args.fileId)] ?? null,
      },
    });
    const executor = await makeExecutor(ctx);

    const denied = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'file_foreign' },
    });
    const deniedShared = await executor.execute({
      id: 'call_2',
      name: 'rag_fetch',
      input: { ref: 'file_foreign_shared' },
    });
    const missing = await executor.execute({
      id: 'call_3',
      name: 'rag_fetch',
      input: { ref: 'file_absent' },
    });

    expect(denied.status).toBe('not_found');
    expect(denied).toEqual(missing);
    expect(deniedShared).toEqual(missing);
    expect(JSON.stringify(denied)).not.toContain('Team-private');
    expect(JSON.stringify(denied)).not.toContain('Q3 plan');
    expect(JSON.stringify(deniedShared)).not.toContain('Two-team-private');
  });

  it('hides an out-of-scope project row the same way', async () => {
    fetchDocumentByFileIdMock.mockResolvedValueOnce(null);
    const { ctx } = createCtx({
      reads: {
        [DOCUMENT_ROW_FN]: () => ({
          content: 'Project-private inline body.',
          title: 'Rollout plan',
          projectId: 'proj-OTHER',
        }),
      },
    });
    const executor = await makeExecutor(ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'rag_fetch',
        input: { ref: 'file_proj' },
      }),
    ).resolves.toMatchObject({ status: 'not_found' });
  });

  it('answers an empty corpus AND an empty row with an honest not_found', async () => {
    // The corpus knows the document but carries no text; the row has none
    // either — the miss must say so, never fabricate.
    fetchDocumentByFileIdMock.mockResolvedValueOnce({
      fileId: 'file_3',
      filename: null,
      folderPath: null,
      modifiedAt: null,
      text: '',
    });
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'rag_fetch',
        input: { ref: 'file_3' },
      }),
    ).resolves.toMatchObject({
      status: 'not_found',
      message: expect.stringContaining('Documents page'),
    });
  });

  it('pages long content through offset, and the second window returns the tail', async () => {
    const head = 'a'.repeat(20_000);
    const tail = 'b'.repeat(500);
    const doc = {
      fileId: 'file_long',
      filename: 'long.txt',
      folderPath: null,
      modifiedAt: null,
      text: head + tail,
    };
    fetchDocumentByFileIdMock
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce(doc);
    const executor = await makeExecutor(createCtx().ctx);

    const first = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'file_long' },
    });
    expect(first.status).toBe('ok');
    expect(first.content).toBe(head);
    expect(first.totalChars).toBe(20_500);
    expect(first.offset).toBe(0);
    expect(first.nextOffset).toBe(20_000);

    const second = await executor.execute({
      id: 'call_2',
      name: 'rag_fetch',
      input: { ref: 'file_long', offset: first.nextOffset },
    });
    expect(second.status).toBe('ok');
    expect(second.content).toBe(tail);
    expect(second.offset).toBe(20_000);
    expect(second.nextOffset).toBeUndefined();
  });

  it('serves an exact range through offset + limit, reporting the next offset', async () => {
    const text = 'x'.repeat(1000) + 'MATCH' + 'y'.repeat(1000);
    fetchDocumentByFileIdMock.mockResolvedValueOnce({
      fileId: 'file_range',
      filename: 'range.txt',
      folderPath: null,
      modifiedAt: null,
      text,
    });
    const executor = await makeExecutor(createCtx().ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'file_range', offset: 1000, limit: 5 },
    });
    expect(result.status).toBe('ok');
    expect(result.content).toBe('MATCH');
    expect(result.offset).toBe(1000);
    expect(result.nextOffset).toBe(1005);
    expect(result.totalChars).toBe(2005);
  });

  it('clamps an oversized limit to the window maximum', async () => {
    fetchDocumentByFileIdMock.mockResolvedValueOnce({
      fileId: 'file_cap',
      filename: 'cap.txt',
      folderPath: null,
      modifiedAt: null,
      text: 'z'.repeat(30_000),
    });
    const executor = await makeExecutor(createCtx().ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'rag_fetch',
      input: { ref: 'file_cap', limit: 999_999 },
    });
    expect(result.status).toBe('ok');
    expect(result.content).toHaveLength(20_000);
    expect(result.nextOffset).toBe(20_000);
  });

  it('needs a ref', async () => {
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({ id: 'call_1', name: 'rag_fetch', input: {} }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
  });
});

describe('web_fetch', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['a plain-http URL', 'http://example.com/page', /https/i],
    [
      'a URL with embedded credentials',
      'https://user:pw@example.com/page',
      /credentials/i,
    ],
    ['a private host', 'https://localhost/admin', /private/i],
  ])('refuses %s before any network call', async (_name, url, pattern) => {
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({ id: 'call_1', name: 'web_fetch', input: { url } }),
    ).resolves.toMatchObject({
      status: 'invalid_args',
      message: expect.stringMatching(pattern),
    });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('reports a fetch failure as an error naming the kind — never a throw', async () => {
    safeFetchMock.mockRejectedValueOnce(
      new SafeFetchError('timeout', 'Request timed out after 15000ms'),
    );
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'web_fetch',
        input: { url: 'https://example.com/slow' },
      }),
    ).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('timeout'),
    });
  });

  it('reports an HTTP failure with the status text', async () => {
    safeFetchMock.mockResolvedValueOnce({
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      body: '',
      finalUrl: 'https://example.com/missing',
    });
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'web_fetch',
        input: { url: 'https://example.com/missing' },
      }),
    ).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('404 Not Found'),
    });
  });

  it('says plainly when the content type is unreadable', async () => {
    safeFetchMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/pdf' }),
      body: '%PDF-1.7',
      finalUrl: 'https://example.com/file.pdf',
    });
    const executor = await makeExecutor(createCtx().ctx);
    await expect(
      executor.execute({
        id: 'call_1',
        name: 'web_fetch',
        input: { url: 'https://example.com/file.pdf' },
      }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('application/pdf'),
    });
  });

  it('extracts the title and wraps the page text as untrusted content', async () => {
    safeFetchMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      body:
        '<html><head><title>Acme — Home</title></head>' +
        '<body><h1>Welcome</h1><p>Hello from Acme.</p></body></html>',
      finalUrl: 'https://example.com/page',
    });
    const executor = await makeExecutor(createCtx().ctx);

    const result = await executor.execute({
      id: 'call_1',
      name: 'web_fetch',
      input: { url: 'https://example.com/page' },
    });

    expect(result.status).toBe('ok');
    expect(result.url).toBe('https://example.com/page');
    expect(result.title).toBe('Acme — Home');
    expect(result.content).toContain('<untrusted_source tool="web_fetch"');
    expect(result.content).toContain('url="https://example.com/page"');
    expect(result.content).toContain('# Welcome');
    expect(result.content).toContain('Hello from Acme.');
    expect(safeFetchMock).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({ maxResponseBytes: expect.any(Number) }),
    );
  });
});
