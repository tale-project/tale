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
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  searchKnowledgeForOrg,
}));
vi.mock('./memories.ts', () => ({ saveMemory, searchApprovedMemories }));
vi.mock('./shim.ts', () => ({ resolveAccessScope }));

import { KnowledgeError } from '../knowledge/service.ts';
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

  // The REST search's citation fields ride the MCP passage too: an MCP
  // client could not follow a hit to `GET /api/v1/documents/{id}` without a
  // second search over REST (2026-09-19 evaluation, K8-1).
  it('carries documentId, corpus, chunkIndex and projectId on each passage', async () => {
    searchKnowledgeForOrg.mockResolvedValue({
      hits: [
        {
          id: 'row-1',
          corpus: 'documents',
          text: 'Returns within 30 days.',
          source: {
            ref: 's3:acme/blob-1',
            title: 'Returns policy',
            documentId: 'doc-1',
            projectId: null,
          },
          chunkIndex: 2,
          score: 9.1,
          fusedScore: 0.5,
          similarity: 0.71,
        },
        {
          id: 'row-2',
          corpus: 'web',
          text: 'Shipping takes two days.',
          source: {
            ref: 'https://shop.example/shipping',
            title: 'Shipping',
            url: 'https://shop.example/shipping',
          },
          chunkIndex: 0,
          score: 0.6,
          fusedScore: 0.25,
        },
      ],
    });
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });
    const result = await surface.dispatch('get_knowledge', {
      query: 'returns',
    });
    expect(result).toEqual({
      status: 'ok',
      passages: [
        {
          text: 'Returns within 30 days.',
          source: 'Returns policy',
          ref: 's3:acme/blob-1',
          corpus: 'documents',
          chunkIndex: 2,
          documentId: 'doc-1',
          score: 0.5,
          similarity: 0.71,
        },
        {
          text: 'Shipping takes two days.',
          source: 'Shipping',
          ref: 'https://shop.example/shipping',
          corpus: 'web',
          chunkIndex: 0,
          score: 0.25,
          url: 'https://shop.example/shipping',
        },
      ],
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

    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'KNOWLEDGE_UNAVAILABLE',
    });
    expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
  });

  it('names the knowledge door’s own code when the search refuses, so a model branches on it', async () => {
    searchKnowledgeForOrg.mockRejectedValue(
      new KnowledgeError('KNOWLEDGE_QUERY_TOO_LONG', 'query too long'),
    );
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });

    const result = await surface.dispatch('get_knowledge', { query: 'x' });

    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'KNOWLEDGE_QUERY_TOO_LONG',
      reason: expect.stringContaining('query too long'),
    });
  });
});

describe('the automation registry of the capability surface', () => {
  it('holds deployed automations only — a saved-only one is no capability, as the MCP page says', async () => {
    pgAutomationStore.mockReturnValue({
      list: () =>
        Promise.resolve([
          { name: 'billing/dunning', deployedVersion: 2 },
          { name: 'billing/drafts', deployedVersion: null },
        ]),
    });
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });

    const found = await surface.dispatch('search_capabilities', {
      query: 'billing',
    });

    expect(found).toEqual({
      capabilities: [
        expect.objectContaining({ id: 'automation.billing/dunning' }),
      ],
    });
    await expect(
      surface.invokeCapability({ id: 'automation.billing/drafts' }),
    ).resolves.toMatchObject({
      status: 'refused',
      code: 'CAPABILITY_NOT_FOUND',
    });
  });
});
