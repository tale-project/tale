// @vitest-environment node

/**
 * The discovery tools: what an automation may name, read from the same
 * readers the editor's pickers use — for the caller, in the caller's
 * organization, under the app's own rules — and never a secret's value. The
 * readers are doubles; each has its own tests.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMITTED_EVENT_TYPES,
  RESERVED_EVENT_TYPES,
} from '../../../lib/shared/event-types.ts';
import type { McpCaller } from './caller.ts';

const mocks = vi.hoisted(() => ({
  listGovernedChatModels: vi.fn(),
  listManagedHarnesses: vi.fn(),
  listAutomationCapabilities: vi.fn(),
  listProjectCapabilities: vi.fn(),
  listConnectorSummaries: vi.fn(),
  listConnectedConnectorSlugs: vi.fn(),
  listAgentSecrets: vi.fn(),
  listProjects: vi.fn(),
  getProjectAuthContext: vi.fn(),
  readableProject: vi.fn(),
  listAutomations: vi.fn(),
}));

vi.mock('../chat/composer.ts', () => ({
  listGovernedChatModels: mocks.listGovernedChatModels,
  listManagedHarnesses: mocks.listManagedHarnesses,
  listAutomationCapabilities: mocks.listAutomationCapabilities,
  listProjectCapabilities: mocks.listProjectCapabilities,
}));
vi.mock('../../core/connector_credentials/connector_catalog.ts', () => ({
  listConnectorSummaries: mocks.listConnectorSummaries,
}));
vi.mock('../connector_credentials/service.ts', () => ({
  listConnectedConnectorSlugs: mocks.listConnectedConnectorSlugs,
}));
vi.mock('../agent_secrets/service.ts', () => ({
  listAgentSecrets: mocks.listAgentSecrets,
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: mocks.listProjects,
  getProjectAuthContext: mocks.getProjectAuthContext,
}));
vi.mock('../automations/project-visibility.ts', async (original) => ({
  ...(await original<typeof import('../automations/project-visibility.ts')>()),
  readableProject: mocks.readableProject,
}));
vi.mock('../automations/store.ts', () => ({
  listAutomations: mocks.listAutomations,
}));
vi.mock('../automations/metrics.ts', () => ({
  getOrgAutomationMetrics: vi.fn(),
}));

import { dispatchPlatformTool } from './platform-tools.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every read is a double
const sql = {} as unknown as Sql;
const SENTINEL = 'SENTINEL-secret-value-7f3a';

const ada: McpCaller = {
  organizationId: 'org_acme',
  orgSlug: 'acme',
  userId: 'user_ada',
  role: 'admin',
  credential: { kind: 'api-key', apiKeyId: 'key_ada' },
};
const mia: McpCaller = { ...ada, userId: 'user_mia', role: 'member' };

const call = (
  caller: McpCaller,
  tool: string,
  params: Record<string, unknown> = {},
) =>
  dispatchPlatformTool(sql, caller, tool, params) as Promise<
    Record<string, unknown>
  >;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listManagedHarnesses.mockReturnValue([
    {
      harness: 'claude-code',
      label: 'Claude Code',
      toolCallingWire: 'anthropic',
    },
    { harness: 'codex', label: 'Codex', toolCallingWire: 'openai-responses' },
  ]);
  mocks.listGovernedChatModels.mockResolvedValue([
    {
      id: 'gpt-6-luna',
      label: 'GPT 6 Luna',
      providerSlug: 'openai',
      providerLabel: 'OpenAI',
      credential: { authMethod: 'api-key' },
      contextWindow: 200_000,
      tools: true,
      tags: [],
    },
    {
      id: 'gpt-6.1-sol',
      label: 'GPT 6.1 Sol',
      providerSlug: 'openai',
      providerLabel: 'OpenAI',
      toolCallingApi: 'responses',
      credential: { authMethod: 'env' },
      contextWindow: 400_000,
      tools: true,
      tags: [],
    },
    {
      id: 'claude-fable-5',
      label: 'Claude Fable 5',
      providerSlug: 'anthropic',
      providerLabel: 'Anthropic',
      credential: {
        authMethod: 'subscription-broker',
        constraints: { harness: 'claude-code' },
      },
      contextWindow: 200_000,
      vision: true,
      tools: true,
      tags: [],
    },
  ]);
  mocks.getProjectAuthContext.mockImplementation(
    async (_sql: unknown, member: Record<string, unknown>) => ({
      ...member,
      teamIds: [],
    }),
  );
});

describe('list_models', () => {
  it('offers each model where the editor would: llm steps take a directly served one, agent steps one offered to their runtime', async () => {
    const answer = await call(ada, 'list_models');
    expect(mocks.listGovernedChatModels).toHaveBeenCalledWith(sql, {
      organizationId: 'org_acme',
      userId: 'user_ada',
    });
    expect(answer.models).toEqual([
      expect.objectContaining({
        id: 'gpt-6-luna',
        providerSlug: 'openai',
        lane: 'direct',
        nodeTypes: ['llm', 'agent'],
        harnesses: ['claude-code', 'codex'],
      }),
      expect.objectContaining({
        id: 'gpt-6.1-sol',
        lane: 'direct',
        nodeTypes: ['llm', 'agent'],
        harnesses: ['codex'],
      }),
      expect.objectContaining({
        id: 'claude-fable-5',
        lane: 'broker',
        nodeTypes: ['agent'],
        harnesses: ['claude-code'],
        vision: true,
      }),
    ]);
    expect(JSON.stringify(answer)).not.toContain('authMethod');
  });

  it('filters by step type and by runtime', async () => {
    const llm = await call(ada, 'list_models', { nodeType: 'llm' });
    expect(
      (llm.models as Array<{ id: string }>).map((model) => model.id),
    ).toEqual(['gpt-6-luna', 'gpt-6.1-sol']);
    const claude = await call(ada, 'list_models', { harness: 'claude-code' });
    expect(
      (claude.models as Array<{ id: string }>).map((model) => model.id),
    ).toEqual(['gpt-6-luna', 'claude-fable-5']);
  });

  it('answers no model for a runtime this deployment does not run, and says where to look', async () => {
    const answer = await call(ada, 'list_models', { harness: 'cursor' });
    expect(answer.models).toEqual([]);
    expect(answer.hint).toContain('list_harnesses');
    expect(mocks.listGovernedChatModels).not.toHaveBeenCalled();
  });
});

describe('list_harnesses', () => {
  it('names the runtimes, the default, and which a subscription can serve', async () => {
    const answer = await call(mia, 'list_harnesses');
    expect(answer.harnesses).toEqual([
      expect.objectContaining({
        slug: 'claude-code',
        label: 'Claude Code',
        default: true,
        subscription: true,
      }),
      expect.objectContaining({ slug: 'codex', default: false }),
    ]);
  });
});

describe('the discovery tools answer only what the person may see [MCP-R23]', () => {
  it('lists the organization’s skills, or a readable project’s, and answers another project as not found [MCP-R23]', async () => {
    mocks.listAutomationCapabilities.mockResolvedValue({
      skills: [
        { slug: 'reply-style', label: 'reply-style', description: 'Tone' },
      ],
      connectors: [],
    });
    expect(await call(mia, 'list_skills')).toMatchObject({
      skills: [{ slug: 'reply-style', description: 'Tone' }],
    });
    expect(mocks.listAutomationCapabilities).toHaveBeenCalledWith(
      sql,
      { organizationId: 'org_acme' },
      { attribution: false },
    );

    mocks.readableProject.mockResolvedValueOnce({ id: 'proj_sales' });
    mocks.listProjectCapabilities.mockResolvedValue({
      skills: [{ slug: 'sales-deck', label: 'sales-deck' }],
      connectors: [],
    });
    expect(
      await call(mia, 'list_skills', { projectId: 'proj_sales' }),
    ).toMatchObject({ skills: [{ slug: 'sales-deck' }] });
    expect(mocks.listProjectCapabilities).toHaveBeenCalledWith(
      sql,
      {
        organizationId: 'org_acme',
        userId: 'user_mia',
        projectId: 'proj_sales',
      },
      { attribution: false },
    );

    // Another team's project, or another organization's: the same answer.
    mocks.readableProject.mockResolvedValueOnce(null);
    expect(
      await call(mia, 'list_skills', { projectId: 'proj_beta_hr' }),
    ).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(mocks.listProjectCapabilities).toHaveBeenCalledTimes(1);
  });

  it('names the connectors this deployment offers and which this organization connected [MCP-R23]', async () => {
    mocks.listConnectorSummaries.mockReturnValue([
      {
        slug: 'github',
        displayName: 'GitHub',
        description: 'Issues and pull requests',
        actionCount: 12,
      },
      {
        slug: 'gmail',
        displayName: 'Gmail',
        description: 'Mail',
        actionCount: 5,
      },
    ]);
    mocks.listConnectedConnectorSlugs.mockResolvedValue(['github']);
    const answer = await call(mia, 'list_connectors');
    expect(mocks.listConnectedConnectorSlugs).toHaveBeenCalledWith(
      sql,
      'org_acme',
    );
    expect(answer.connectors).toEqual([
      {
        slug: 'github',
        name: 'GitHub',
        description: 'Issues and pull requests',
        connected: true,
        actions: 12,
      },
      {
        slug: 'gmail',
        name: 'Gmail',
        description: 'Mail',
        connected: false,
        actions: 5,
      },
    ]);
    expect(
      (await call(mia, 'list_connectors', { query: 'MAIL' })).connectors,
    ).toEqual([expect.objectContaining({ slug: 'gmail' })]);
  });

  it('tells an owner, admin or developer the secret names, never a value; anyone else nothing [MCP-R23]', async () => {
    mocks.listAgentSecrets.mockResolvedValue([
      {
        name: 'CRM_TOKEN',
        description: 'CRM API',
        maskedPreview: 'crm_••••x9a',
        createdAt: 1,
        updatedAt: 2,
        updatedBy: 'user_ada',
        // A value that ever reached a listing row must still not reach the
        // answer.
        encryptedValue: SENTINEL,
      },
    ]);
    const admin = await call(ada, 'list_agent_secrets');
    expect(mocks.listAgentSecrets).toHaveBeenCalledWith(sql, 'org_acme');
    expect(admin.secrets).toEqual([
      { name: 'CRM_TOKEN', description: 'CRM API', preview: 'crm_••••x9a' },
    ]);
    expect(JSON.stringify(admin)).not.toContain(SENTINEL);

    mocks.listAgentSecrets.mockClear();
    const member = await call(mia, 'list_agent_secrets');
    expect(member.secrets).toEqual([]);
    expect(member.note).toMatch(/owners, admins and developers/);
    expect(mocks.listAgentSecrets).not.toHaveBeenCalled();
  });

  it('lists the projects the person can read, with only the automations they may see [MCP-R23]', async () => {
    mocks.listProjects.mockResolvedValue([
      { id: 'proj_sales', name: 'Sales', archivedAt: null, canEdit: true },
      { id: 'proj_old', name: 'Old sales', archivedAt: 5, canEdit: false },
    ]);
    mocks.listAutomations.mockResolvedValue([
      { name: 'sales/follow-up', projectIds: ['proj_sales'] },
      // Installed in Sales and in a project Mia cannot read: listed under
      // Sales only.
      { name: 'sales/forecast', projectIds: ['proj_sales', 'proj_hr'] },
      { name: 'hr/onboarding', projectIds: ['proj_hr'] },
      { name: 'org/digest', projectIds: [] },
    ]);
    const answer = await call(mia, 'list_projects', { includeArchived: true });
    expect(mocks.getProjectAuthContext).toHaveBeenCalledWith(sql, {
      organizationId: 'org_acme',
      userId: 'user_mia',
      role: 'member',
    });
    expect(mocks.listProjects).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ organizationId: 'org_acme' }),
      { includeArchived: true, summary: true },
    );
    expect(mocks.listAutomations).toHaveBeenCalledWith(sql, 'org_acme');
    expect(answer.projects).toEqual([
      {
        id: 'proj_sales',
        name: 'Sales',
        archived: false,
        writable: true,
        automations: ['sales/follow-up', 'sales/forecast'],
      },
      {
        id: 'proj_old',
        name: 'Old sales',
        archived: true,
        writable: false,
        automations: [],
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain('hr/onboarding');
    expect(JSON.stringify(answer)).not.toContain('proj_hr');

    expect(
      (await call(mia, 'list_projects', { query: 'old' })).projects,
    ).toEqual([expect.objectContaining({ id: 'proj_old' })]);
  });
});

describe('list_events', () => {
  it('names every event Tale raises, with when it fires, and none it only reserves', async () => {
    const answer = await call(mia, 'list_events');
    const names = (answer.events as Array<{ name: string }>).map(
      (event) => event.name,
    );
    expect(names.sort()).toEqual([...EMITTED_EVENT_TYPES].sort());
    for (const reserved of RESERVED_EVENT_TYPES) {
      expect(names).not.toContain(reserved);
    }
  });
});
