// @vitest-environment node

/**
 * The knowledge scope a chat turn (and a user-keyed sandbox session, which
 * borrows this handler) searches with. What is pinned: a live member's scope
 * ADMITS conversation-scoped rows — emailed attachments — for the live-truth
 * re-check to decide, and carries the identity that re-check decides by.
 * Without both, the #3220 decision could not fire for anyone: the SQL
 * pre-filter never yielded the rows, and the filter never knew who asked.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatToolExecutor } from '../../core/chat/assistant_tools.ts';
import { searchKnowledge } from '../../core/knowledge/search.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { dispatchWorkspaceToolImpl } from '../../core/node_only/sandbox/workspace_tools_bridge.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { listDocumentsForAgent } from '../documents/agent-list.ts';
import { listEntriesForAgent } from '../knowledge_entries/service.ts';
import { sandboxToolShimHandlers } from '../sandbox/shim.ts';
import { chatShimHandlers } from './shim.ts';

vi.mock('../../core/knowledge/search.ts', () => ({
  searchKnowledge: vi.fn(() => Promise.resolve({ hits: [], diagnostics: {} })),
}));
vi.mock('../../core/lib/helpers/org_slug.ts', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));
vi.mock('../knowledge_entries/service.ts', () => ({
  listEntriesForAgent: vi.fn(() =>
    Promise.resolve({
      page: [
        {
          _id: 'entry-org',
          topic: 'Organization knowledge',
          content: 'Shared organization fact',
        },
      ],
      isDone: true,
      continueCursor: '',
    }),
  ),
}));

vi.mock('../documents/agent-list.ts', () => ({
  listDocumentsForAgent: vi.fn(() =>
    Promise.resolve({
      documents: [],
      totalCount: null,
      hasMore: false,
      cursor: null,
      warning: null,
    }),
  ),
}));

vi.mock('../../auth/membership.ts', () => {
  const findOrganizationMember = vi.fn(
    (_sql: unknown, organizationId: string, userId: string) =>
      Promise.resolve(
        userId === 'u-gone'
          ? null
          : {
              id: 'm-1',
              organizationId,
              userId,
              role: userId === 'u-disabled' ? 'disabled' : 'member',
            },
      ),
  );
  // The acting member is the person's own row — or, for `u-project-key`,
  // a project's own API key acting as a developer.
  const findActingMember = vi.fn(
    (sql: unknown, organizationId: string, userId: string) =>
      ['u-project-key', 'u-team-key', 'u-org-key'].includes(userId)
        ? Promise.resolve({
            id: 'api-key:key-1',
            organizationId,
            userId,
            role: 'developer',
            apiKeyOwner:
              userId === 'u-project-key'
                ? { kind: 'project', projectId: 'proj-1' }
                : userId === 'u-team-key'
                  ? { kind: 'team', teamId: 'team-a', projectId: null }
                  : { kind: 'organization', projectId: null },
          })
        : findOrganizationMember(sql, organizationId, userId),
  );
  return { findOrganizationMember, findActingMember };
});

vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(
    (
      _sql: unknown,
      args: { organizationId: string; userId: string },
      _email?: string,
      options: { projectScope?: string } = {},
    ) =>
      Promise.resolve({
        organizationId: args.organizationId,
        userId: args.userId,
        role: 'member',
        teamIds: ['team-a'],
        ...(options.projectScope !== undefined
          ? { projectScope: options.projectScope }
          : {}),
      }),
  ),
  listProjects: vi.fn(() =>
    Promise.resolve([{ id: 'proj-1', archivedAt: null }]),
  ),
}));

const RESOLVE = 'documents/internal_queries:resolveKnowledgeAccess';

async function resolve(userId: string): Promise<Record<string, unknown>> {
  const handler = chatShimHandlers({} as unknown as Sql)[RESOLVE];
  if (handler === undefined) throw new Error('resolver missing');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler answers the scope object
  return (await handler({ organizationId: 'org-1', userId })) as Record<
    string,
    unknown
  >;
}

describe('the chat document listing door', () => {
  const LIST = 'documents/internal_queries:listForAgent';

  async function list(args: Record<string, unknown>): Promise<void> {
    const handler = chatShimHandlers({} as unknown as Sql)[LIST];
    if (handler === undefined) throw new Error('list door missing');
    await handler({ organizationId: 'org-1', userId: 'u-1', ...args });
  }

  it('passes the pinned project AND the hub union for a readable project', async () => {
    await list({ projectId: 'proj-1', includeHub: true, limit: 20 });
    expect(listDocumentsForAgent).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        teamIds: ['team-a'],
        isAdmin: false,
        projectId: 'proj-1',
        includeHub: true,
        limit: 20,
      }),
    );
  });

  it('falls through to the hub lane for a project the caller cannot read', async () => {
    // The 0.4 fail-safe, kept: an unreadable project never loosens the
    // boundary — the page is the hub alone, and `includeHub` rides only with
    // a project lane it may join.
    await list({ projectId: 'proj-secret', includeHub: true });
    const call = vi.mocked(listDocumentsForAgent).mock.lastCall?.[1];
    expect(call).not.toHaveProperty('projectId');
    expect(call).not.toHaveProperty('includeHub');
  });
});

/**
 * A project's own API key reaches its project alone through the chat tools
 * too: its files and tasks, never the hub's documents — not even their
 * titles — and none of the organization's contacts, products, websites or
 * inbox.
 */
describe('a project’s own API key in the chat tools [APIKEY-R6]', () => {
  const handlers = () => chatShimHandlers({} as unknown as Sql);

  it('lists its project’s files and never the hub', async () => {
    const list = handlers()['documents/internal_queries:listForAgent'];
    if (list === undefined) throw new Error('list door missing');
    for (const args of [
      { includeHub: true },
      { projectId: 'proj-1', includeHub: true },
    ]) {
      vi.mocked(listDocumentsForAgent).mockClear();
      await list({ organizationId: 'org-1', userId: 'u-project-key', ...args });
      const call = vi.mocked(listDocumentsForAgent).mock.calls[0]?.[1];
      expect(call).toMatchObject({ projectIds: ['proj-1'] });
      expect(call).not.toHaveProperty('includeHub');
    }
  });

  it('reads its project’s subjects and none of the organization’s', async () => {
    const gate =
      handlers()['sandbox/workspace_access:resolveWorkspaceReadAccess'];
    if (gate === undefined) throw new Error('gate missing');
    const allowed = async (userId: string, subject: string) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the gate answers { allowed }
      (
        (await gate({ organizationId: 'org-1', userId, subject })) as {
          allowed: boolean;
        }
      ).allowed;
    for (const subject of ['documents', 'tasks', 'projects']) {
      expect(await allowed('u-project-key', subject)).toBe(true);
    }
    for (const subject of [
      'knowledge_entries',
      'contacts',
      'products',
      'websites',
      'conversations',
    ]) {
      expect(await allowed('u-project-key', subject)).toBe(false);
      // A member reads them all.
      expect(await allowed('u-1', subject)).toBe(true);
    }
  });
});

describe('the chat turn knowledge scope', () => {
  it('admits conversation-scoped rows for a live member and names them', async () => {
    const scope = await resolve('u-1');
    expect(scope).toMatchObject({
      teamIds: ['team-a'],
      isAdmin: false,
      projectIds: ['proj-1'],
      includeHub: true,
      includeConversationScoped: true,
      userId: 'u-1',
    });
  });

  it('admits nothing for a disabled or missing member', async () => {
    for (const userId of ['u-disabled', 'u-gone']) {
      const scope = await resolve(userId);
      expect(scope).toMatchObject({
        teamIds: [],
        projectIds: [],
        includeHub: false,
        includeConversationScoped: false,
      });
    }
  });
});

/** The real executor/bridge dispatch through the real SQL shim gates. Only
 * storage/search edges and observation writes are substitutes; a refused
 * dispatch must never reach the organization-wide entry reader. */
function composedTools(userId: string) {
  const sqlQuery = vi.fn(() => Promise.resolve([]));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SQL readers used here only need an empty row set; membership/project resolution is mocked above
  const sql = sqlQuery as unknown as Sql;
  const handlers = sandboxToolShimHandlers(sql);
  const ctx = createCtxShim({
    ...handlers,
    'audit_logs/internal_mutations:createAuditLog': async () => null,
    'governance/internal_mutations:recordConnectorUsage': async () => null,
    'sandbox/session_mutations:recordToolCall': async () => null,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- production uses this same shim for the ActionCtx query/mutation/action surface
  const actionCtx = ctx as unknown as ActionCtx;
  return {
    chat: createChatToolExecutor(actionCtx, {
      organizationId: 'org-1',
      userId,
      projectId: 'proj-1',
    }),
    find: (tool: string) =>
      dispatchWorkspaceToolImpl(actionCtx, {
        organizationId: 'org-1',
        sessionId: 'user-session',
        userId,
        tool,
        callArgs: {},
      }),
  };
}

describe('composed project-key knowledge tools [APIKEY-R6]', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { query: 'Organization knowledge' },
    { query: 'Organization knowledge', kind: 'knowledge-entry' },
  ])(
    'refuses organization entries in search %j before their reader',
    async (input) => {
      const result = await composedTools('u-project-key').chat.execute({
        id: 'search',
        name: 'rag_search',
        input,
      });
      expect(result).toMatchObject({
        status: 'ok',
        results: [],
        sources: { knowledgeEntries: 'access denied for your role' },
      });
      expect(listEntriesForAgent).not.toHaveBeenCalled();
    },
  );

  it('refuses organization-entry listing before its reader', async () => {
    const result = await composedTools('u-project-key').chat.execute({
      id: 'list',
      name: 'rag_search',
      input: { action: 'list', kind: 'knowledge-entry' },
    });
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(listEntriesForAgent).not.toHaveBeenCalled();
  });

  it('refuses the sandbox entry finder through the real session fallback', async () => {
    expect(
      await composedTools('u-project-key').find('knowledge_entry_find'),
    ).toMatchObject({ status: 'unavailable' });
    expect(listEntriesForAgent).not.toHaveBeenCalled();
  });

  it('keeps project document search and listing scoped and available', async () => {
    const tools = composedTools('u-project-key');
    expect(
      await tools.chat.execute({
        id: 'documents',
        name: 'rag_search',
        input: { query: 'launch budget', kind: 'document' },
      }),
    ).toMatchObject({ status: 'ok' });
    expect(searchKnowledge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        access: expect.objectContaining({
          projectIds: ['proj-1'],
          includeHub: false,
        }),
      }),
    );
    expect(
      await tools.chat.execute({
        id: 'document-list',
        name: 'rag_search',
        input: { action: 'list', kind: 'document' },
      }),
    ).toMatchObject({ status: 'ok' });
    expect(await tools.find('document_find')).toMatchObject({ status: 'ok' });
    expect(listDocumentsForAgent).toHaveBeenCalledTimes(2);
    for (const [, args] of vi.mocked(listDocumentsForAgent).mock.calls) {
      expect(args).toMatchObject({ projectIds: ['proj-1'] });
      expect(args).not.toHaveProperty('includeHub');
    }
    expect(listEntriesForAgent).not.toHaveBeenCalled();
  });

  it.each(['u-1', 'u-team-key', 'u-org-key'])(
    'preserves authorized search, listing and sandbox entry reads for %s',
    async (userId) => {
      const tools = composedTools(userId);
      for (const input of [
        { query: 'Organization knowledge', kind: 'knowledge-entry' },
        { action: 'list', kind: 'knowledge-entry' },
      ]) {
        expect(
          await tools.chat.execute({
            id: 'allowed',
            name: 'rag_search',
            input,
          }),
        ).toMatchObject({
          status: 'ok',
          results: [expect.objectContaining({ kind: 'knowledge-entry' })],
        });
      }
      expect(await tools.find('knowledge_entry_find')).toMatchObject({
        status: 'ok',
      });
      expect(listEntriesForAgent).toHaveBeenCalledTimes(3);
    },
  );
});
