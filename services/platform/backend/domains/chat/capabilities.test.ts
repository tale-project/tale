// @vitest-environment node

/**
 * The 0.5 capability surface's knowledge port: `get_knowledge` searches as
 * the key holder, with the holder's OWN visibility — never the whole org.
 * The REST/MCP door binds a key to its minting user and admits any
 * non-disabled member role, so the port must apply the same scope the chat
 * tools do for that user (teams, readable projects, the hub).
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAuditLog,
  pgAutomationStore,
  resolveAccessScope,
  runConnectorAction,
  saveMemory,
  searchApprovedMemories,
  searchKnowledgeForOrg,
} = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  pgAutomationStore: vi.fn(),
  resolveAccessScope: vi.fn(),
  runConnectorAction: vi.fn(),
  saveMemory: vi.fn(),
  searchApprovedMemories: vi.fn(),
  searchKnowledgeForOrg: vi.fn(),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../automations/dispatch-store.ts', () => ({ pgAutomationStore }));
vi.mock('../connectors/service.ts', () => ({ runConnectorAction }));
vi.mock('../knowledge/service.ts', () => ({ searchKnowledgeForOrg }));
vi.mock('./memories.ts', () => ({ saveMemory, searchApprovedMemories }));
vi.mock('./shim.ts', () => ({ resolveAccessScope }));

import { buildCapabilitySurface } from './capabilities.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the surface only threads the handle through to the mocked ports
const sql = {} as Sql;

const HOLDER_SCOPE = {
  teamIds: ['org_1', 'team_a'],
  projectIds: ['project_a'],
  includeHub: true,
  archivedProjectIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  pgAutomationStore.mockReturnValue({ list: () => Promise.resolve([]) });
  resolveAccessScope.mockResolvedValue(HOLDER_SCOPE);
  searchKnowledgeForOrg.mockResolvedValue({ hits: [] });
});

describe('get_knowledge on the capability surface', () => {
  it('searches with the key holder’s own visibility, never the whole org', async () => {
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });

    const result = await surface.dispatch('get_knowledge', {
      query: 'returns policy',
      corpus: 'private',
    });

    expect(result).toEqual({ status: 'ok', passages: [] });
    expect(resolveAccessScope).toHaveBeenCalledWith(sql, 'org_1', 'user_1');
    expect(searchKnowledgeForOrg).toHaveBeenCalledTimes(1);
    expect(searchKnowledgeForOrg).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      query: 'returns policy',
      corpus: 'documents',
      // The scope the same person's chat tools search under, stamped with
      // the holder so the retrievability re-check runs as them.
      access: { ...HOLDER_SCOPE, userId: 'user_1' },
    });
  });

  it('resolves the scope per search, so a membership change is honoured on the next call', async () => {
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });
    await surface.dispatch('get_knowledge', { query: 'first' });
    resolveAccessScope.mockResolvedValue({
      ...HOLDER_SCOPE,
      teamIds: ['org_1'],
    });
    await surface.dispatch('get_knowledge', { query: 'second' });

    expect(resolveAccessScope).toHaveBeenCalledTimes(2);
    const second = searchKnowledgeForOrg.mock.calls[1]?.[1] as {
      access: { teamIds: string[] };
    };
    expect(second.access.teamIds).toEqual(['org_1']);
  });

  it('answers unavailable-with-reason when the scope or the search fails', async () => {
    resolveAccessScope.mockRejectedValue(new Error('membership read failed'));
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });

    const result = await surface.dispatch('get_knowledge', { query: 'x' });

    expect(result).toMatchObject({ status: 'unavailable' });
    expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
  });
});
