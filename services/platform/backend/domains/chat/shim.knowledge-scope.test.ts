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
import { describe, expect, it, vi } from 'vitest';

import { listDocumentsForAgent } from '../documents/agent-list.ts';
import { chatShimHandlers } from './shim.ts';

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
      userId === 'u-project-key'
        ? Promise.resolve({
            id: 'api-key:key-1',
            organizationId,
            userId,
            role: 'developer',
            apiKeyOwner: { kind: 'project', projectId: 'proj-1' },
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
