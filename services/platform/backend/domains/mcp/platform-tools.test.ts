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
import { mintCursorFor } from '../../core/lib/signed_cursor.ts';
import type { McpCaller } from './caller.ts';

const mocks = vi.hoisted(() => ({
  listGovernedChatModels: vi.fn(),
  listManagedHarnesses: vi.fn(),
  listAutomationCapabilities: vi.fn(),
  listProjectCapabilities: vi.fn(),
  listConnectorSummaries: vi.fn(),
  listConnectedConnectorSlugs: vi.fn(),
  listAgentSecrets: vi.fn(),
  listProjectsPage: vi.fn(),
  getProjectAuthContext: vi.fn(),
  readableProject: vi.fn(),
  installedAutomationNames: vi.fn(),
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
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  listProjectsPage: mocks.listProjectsPage,
  getProjectAuthContext: mocks.getProjectAuthContext,
}));
vi.mock('../automations/project-visibility.ts', async (original) => ({
  ...(await original<typeof import('../automations/project-visibility.ts')>()),
  readableProject: mocks.readableProject,
}));
vi.mock('../automations/store.ts', () => ({
  installedAutomationNames: mocks.installedAutomationNames,
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

/** A project as the page read answers it: what list_projects reads of it. */
function projectRow(
  id: string,
  name: string,
  createdAt: number,
  archivedAt: number | null = null,
) {
  return { id, name, createdAt, archivedAt, teamIds: [] };
}

/** The automations installed in each project, a project Mia cannot read
 * among them. */
const INSTALLED: Record<string, string[]> = {
  proj_sales: ['sales/follow-up', 'sales/forecast'],
  proj_hr: ['hr/onboarding', 'sales/forecast'],
};

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
  mocks.installedAutomationNames.mockImplementation(
    async (_sql: unknown, _organizationId: string, projectIds: string[]) =>
      new Map(
        Object.entries(INSTALLED).filter(([id]) => projectIds.includes(id)),
      ),
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
        git: { host: 'github.com' },
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
        // The git host its credential opens for an equipped agent.
        gitHost: 'github.com',
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

  it('lists a page of the projects the person can read, with the automations installed in them alone [MCP-R23]', async () => {
    const eve: McpCaller = { ...ada, userId: 'user_eve', role: 'editor' };
    mocks.listProjectsPage.mockResolvedValue({
      projects: [
        projectRow('proj_sales', 'Sales', 2_000),
        projectRow('proj_old', 'Old sales', 1_000, 5),
      ],
      hasMore: false,
    });
    const answer = await call(eve, 'list_projects', { includeArchived: true });
    expect(mocks.getProjectAuthContext).toHaveBeenCalledWith(sql, {
      organizationId: 'org_acme',
      userId: 'user_eve',
      role: 'editor',
    });
    // The readable projects are the read's to choose, one page of them.
    expect(mocks.listProjectsPage).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ organizationId: 'org_acme' }),
      {
        archived: 'include',
        limit: 50,
        cursor: null,
        summary: true,
        name: '',
      },
    );
    // The automations of that page's projects, never the organization's.
    expect(mocks.installedAutomationNames).toHaveBeenCalledExactlyOnceWith(
      sql,
      'org_acme',
      ['proj_sales', 'proj_old'],
    );
    expect(answer).toMatchObject({
      projects: [
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
          // An archived project is read-only for everyone.
          writable: false,
          automations: [],
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(answer)).not.toContain('hr/onboarding');
    expect(JSON.stringify(answer)).not.toContain('proj_hr');
  });

  it('leaves archived projects out unless asked, and answers an empty page with no cursor', async () => {
    mocks.listProjectsPage.mockResolvedValue({ projects: [], hasMore: false });
    expect(await call(mia, 'list_projects')).toMatchObject({
      projects: [],
      nextCursor: null,
    });
    expect(mocks.listProjectsPage).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ organizationId: 'org_acme' }),
      expect.objectContaining({ archived: 'exclude', name: '' }),
    );
  });
});

describe('list_projects pages', () => {
  it('searches the name in the read and goes on from the last project of a page', async () => {
    mocks.listProjectsPage.mockResolvedValueOnce({
      projects: [projectRow('proj_old', 'Old sales', 1_000, 5)],
      hasMore: true,
    });
    const first = await call(mia, 'list_projects', { query: ' old ' });
    expect(mocks.listProjectsPage).toHaveBeenLastCalledWith(
      sql,
      expect.anything(),
      expect.objectContaining({ name: 'old', cursor: null }),
    );
    expect(first.nextCursor).toEqual(expect.any(String));

    mocks.listProjectsPage.mockResolvedValueOnce({
      projects: [projectRow('proj_older', 'Older sales', 500)],
      hasMore: false,
    });
    const second = await call(mia, 'list_projects', {
      query: 'old',
      cursor: first.nextCursor,
    });
    expect(mocks.listProjectsPage).toHaveBeenLastCalledWith(
      sql,
      expect.anything(),
      expect.objectContaining({
        name: 'old',
        cursor: { at: 1_000, id: 'proj_old' },
      }),
    );
    expect(second).toMatchObject({
      projects: [{ id: 'proj_older' }],
      nextCursor: null,
    });
  });

  it.each([
    ['a made-up cursor', {}, 'p50'],
    ['an unsigned position', {}, '1000:proj_old'],
    [
      "another search's cursor",
      { query: 'new' },
      mintCursorFor('org_acme', 'mcp-projects:active:old', '1000:proj_old'),
    ],
    [
      'the cursor of the list without archived projects',
      { includeArchived: true },
      mintCursorFor('org_acme', 'mcp-projects:active:', '1000:proj_old'),
    ],
    [
      "another organization's cursor",
      {},
      mintCursorFor('org_other', 'mcp-projects:active:', '1000:proj_old'),
    ],
    [
      'a signed token that is no position',
      {},
      mintCursorFor('org_acme', 'mcp-projects:active:', 'p50'),
    ],
  ])('refuses %s, and reads nothing', async (_, params, cursor) => {
    expect(
      await call(mia, 'list_projects', { ...params, cursor }),
    ).toMatchObject({ code: 'INVALID_CURSOR' });
    expect(mocks.getProjectAuthContext).not.toHaveBeenCalled();
    expect(mocks.listProjectsPage).not.toHaveBeenCalled();
    expect(mocks.installedAutomationNames).not.toHaveBeenCalled();
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
