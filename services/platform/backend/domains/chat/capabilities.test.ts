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
  findActingMember,
  pgAutomationStore,
  resolveAccessScope,
  runConnectorAction,
  searchKnowledgeForOrg,
} = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  findActingMember: vi.fn(),
  pgAutomationStore: vi.fn(),
  resolveAccessScope: vi.fn(),
  runConnectorAction: vi.fn(),
  searchKnowledgeForOrg: vi.fn(),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../automations/dispatch-store.ts', () => ({ pgAutomationStore }));
vi.mock('../connectors/service.ts', () => ({ runConnectorAction }));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  searchKnowledgeForOrg,
}));
vi.mock('./shim.ts', () => ({ resolveAccessScope }));
vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  findActingMember,
}));

import { KnowledgeError } from '../knowledge/service.ts';
import {
  buildCapabilitySurface,
  dispatchCapabilityAs,
} from './capabilities.ts';

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
      // Embedding the query is the key holder's spend [GOV-R5].
      spender: { userId: 'user_1', agentSlug: '__embedding__' },
      query: 'returns policy',
      corpus: 'documents',
      // The scope the same person's chat tools search under, stamped with
      // the holder so the retrievability re-check runs as them.
      access: { ...HOLDER_SCOPE, userId: 'user_1' },
    });
  });

  it('books the search, and the runs a capability starts, to the key the call came with [GOV-R5]', async () => {
    findActingMember.mockResolvedValue({ role: 'member' });
    await dispatchCapabilityAs(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      apiKeyId: 'key_1',
      method: 'get_knowledge',
      params: { query: 'returns policy' },
    });

    expect(searchKnowledgeForOrg).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        spender: {
          userId: 'user_1',
          agentSlug: '__embedding__',
          apiKeyId: 'key_1',
        },
      }),
    );
    expect(pgAutomationStore).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      actor: 'user_1',
      apiKeyId: 'key_1',
    });
  });

  it('answers a search a usage limit refused with its code and sentence, never as nothing found [GOV-R4]', async () => {
    const { ChatBudgetExceededError } = await import('./budget-admission.ts');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchKnowledgeForOrg.mockRejectedValueOnce(
      new ChatBudgetExceededError({
        code: 'BUDGET_EXCEEDED',
        message:
          'Usage limit reached. Your daily request limit is used up until 2026-10-09T00:00:00.000Z.',
        scope: 'user',
        limitCode: 'REQUEST_LIMIT',
        period: 'daily',
        used: 50,
        limit: 50,
        resetsAt: Date.UTC(2026, 9, 9),
      }),
    );
    const surface = await buildCapabilitySurface(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    });

    const result = await surface.dispatch('get_knowledge', { query: 'x' });

    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'BUDGET_EXCEEDED',
      reason: expect.stringContaining('Your daily request limit is used up'),
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

/**
 * The MCP endpoint's dispatch re-checks who calls before any tool runs: a
 * member, or a team's or the organization's own API key acting with the
 * role it was made with — never a project's key, which reaches its project
 * alone.
 */
describe('dispatchCapabilityAs', () => {
  const call = () =>
    dispatchCapabilityAs(sql, {
      organizationId: 'org_1',
      userId: 'identity_1',
      method: 'get_knowledge',
      params: { query: 'returns policy', corpus: 'private' },
    });
  const acting = (
    role: string,
    kind?: 'team' | 'project' | 'organization',
  ) => ({
    id: 'm-1',
    organizationId: 'org_1',
    userId: 'identity_1',
    role,
    ...(kind !== undefined ? { apiKeyOwner: { kind } } : {}),
  });

  it('lets a team’s or the organization’s key call with the role it was made with [APIKEY-R4]', async () => {
    for (const kind of ['team', 'organization'] as const) {
      findActingMember.mockResolvedValueOnce(acting('editor', kind));
      await expect(call()).resolves.toEqual({ status: 'ok', passages: [] });
    }
  });

  it('refuses a project’s key, a disabled member and a stranger [APIKEY-R6]', async () => {
    for (const member of [
      acting('developer', 'project'),
      acting('disabled'),
      null,
    ]) {
      findActingMember.mockResolvedValueOnce(member);
      await expect(call()).rejects.toMatchObject({ code: 'ORG_FORBIDDEN' });
    }
    expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
  });
});
