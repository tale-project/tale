// @vitest-environment node

/**
 * The changes to projects and agents a chat proposes: the settings tools a
 * turn is offered, the proposal each draft becomes, and what Apply and
 * Dismiss do with it. The projects service, the model listing and the
 * database are stand-ins; the real-Postgres run is the
 * `checkChatProjectAgents` lane of `backend/integration-check.ts`.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatToolExecutor } from '../../../lib/chat/tools.ts';
import type { ComposerModelOption } from '../../core/chat/composer.ts';
import { ProjectError } from '../projects/service.ts';
import {
  applyProposal,
  chatSettingsTools,
  dismissProposal,
  ProposalError,
  proposalFailureOf,
  viewOf,
} from './proposals.ts';

const mocks = vi.hoisted(() => ({
  findActingMember: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  getProjectAuthContext: vi.fn(),
  listProjectAgents: vi.fn(),
  resolveProjectKey: vi.fn(),
  createProject: vi.fn(),
  createProjectAgent: vi.fn(),
  updateProjectAgent: vi.fn(),
  updateProjectIdentity: vi.fn(),
  updateProjectInstructions: vi.fn(),
  setProjectChatAgent: vi.fn(),
  loadProjectOrThrow: vi.fn(),
  assertCanCreateProjects: vi.fn(),
  listComposerModels: vi.fn(),
  listProjectCapabilities: vi.fn(),
  listChatAgents: vi.fn(),
  ensureDefaultProjectLabels: vi.fn(),
  checkUserRateLimit: vi.fn(),
  runInRequestChannel: vi.fn(),
}));

vi.mock('../../auth/membership.ts', () => ({
  findActingMember: mocks.findActingMember,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  listProjects: mocks.listProjects,
  getProject: mocks.getProject,
  getProjectAuthContext: mocks.getProjectAuthContext,
  listProjectAgents: mocks.listProjectAgents,
  resolveProjectKey: mocks.resolveProjectKey,
  createProject: mocks.createProject,
  createProjectAgent: mocks.createProjectAgent,
  updateProjectAgent: mocks.updateProjectAgent,
  updateProjectIdentity: mocks.updateProjectIdentity,
  updateProjectInstructions: mocks.updateProjectInstructions,
  setProjectChatAgent: mocks.setProjectChatAgent,
  loadProjectOrThrow: mocks.loadProjectOrThrow,
  assertCanCreateProjects: mocks.assertCanCreateProjects,
}));
vi.mock('./composer.ts', () => ({
  listComposerModels: mocks.listComposerModels,
  listProjectCapabilities: mocks.listProjectCapabilities,
}));
vi.mock('./agents.ts', () => ({ listChatAgents: mocks.listChatAgents }));
vi.mock('../tasks/service.ts', () => ({
  ensureDefaultProjectLabels: mocks.ensureDefaultProjectLabels,
}));
vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: mocks.checkUserRateLimit,
}));
vi.mock('../../lib/request-channel.ts', () => ({
  runInRequestChannel: mocks.runInRequestChannel,
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (sql: unknown, run: (tx: unknown) => unknown) =>
    run(sql),
}));

const ORG = 'org_1';
const MIA = 'user-mia';
const CHAT = 'thread-1';

const PROJECT = {
  id: 'project-1',
  organizationId: ORG,
  name: 'Website relaunch',
  key: 'WR',
  description: 'The new site.',
  instructions: 'Write plainly.',
  archivedAt: null,
  defaultChatAgentId: null,
  chatsStartWithAssistant: false,
  canEdit: true,
};

const AGENT = {
  id: 'agent-1',
  organizationId: ORG,
  projectId: PROJECT.id,
  name: 'Copy reviewer',
  harness: 'claude-code',
  model: 'chat-model',
  modelProvider: 'gateway',
  skills: ['docx'],
  connectors: [],
  tools: [],
  secrets: [],
  instructions: 'Check the copy.',
  managed: false,
  updatedAt: 1_700_000_000_000,
};

const MODEL: ComposerModelOption = {
  id: 'chat-model',
  label: 'Chat Model',
  providerSlug: 'gateway',
  providerLabel: 'Gateway',
  credential: { authMethod: 'api-key' },
  tools: true,
  contextWindow: 128_000,
  tags: ['chat'],
};

const RESPONSES_MODEL: ComposerModelOption = {
  ...MODEL,
  id: 'responses-model',
  label: 'Responses Model',
  toolCallingApi: 'responses',
};

const HARNESSES = [
  {
    harness: 'claude-code',
    label: 'Claude Code',
    toolCallingWire: 'anthropic' as const,
    anthropicModels: true,
  },
  {
    harness: 'codex',
    label: 'Codex',
    toolCallingWire: 'openai-responses' as const,
    anthropicModels: false,
  },
];

interface StoredProposal {
  id: string;
  orgId: string;
  threadId: string;
  userId: string;
  kind: string;
  projectId: string | null;
  agentId: string | null;
  payload: unknown;
  base: unknown;
  status: string;
  result: unknown;
  createdAt: number;
  decidedAt: number | null;
}

/** A stand-in for `app.chat_proposals` and the reads the module makes. */
function fakeSql(): { sql: Sql; proposals: Map<string, StoredProposal> } {
  const proposals = new Map<string, StoredProposal>();
  let next = 0;
  const viewRow = (row: StoredProposal) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    projectId: row.projectId,
    agentId: row.agentId,
    payload: row.payload,
    base: row.base,
    result: row.result,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    projectName: null,
    agentName: null,
  });
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('INSERT INTO app.chat_proposals')) {
      const [orgId, threadId, userId, kind, projectId, agentId, payload, base] =
        values;
      next += 1;
      const id = `proposal-${next}`;
      proposals.set(id, {
        id,
        orgId: String(orgId),
        threadId: String(threadId),
        userId: String(userId),
        kind: String(kind),
        projectId: (projectId as string | null) ?? null,
        agentId: (agentId as string | null) ?? null,
        payload,
        base: base ?? null,
        status: 'pending',
        result: null,
        createdAt: Number(values[8]),
        decidedAt: null,
      });
      return Promise.resolve([{ id }]);
    }
    if (text.startsWith('SELECT kind FROM app.chat_proposals')) {
      const [id, orgId, userId] = values;
      const row = proposals.get(String(id));
      return Promise.resolve(
        row !== undefined &&
          row.orgId === orgId &&
          row.userId === userId &&
          row.status === 'pending'
          ? [{ kind: row.kind }]
          : [],
      );
    }
    if (text.includes('FOR UPDATE')) {
      const [id, orgId, userId] = values;
      const row = proposals.get(String(id));
      return Promise.resolve(
        row !== undefined && row.orgId === orgId && row.userId === userId
          ? [
              {
                id: row.id,
                threadId: row.threadId,
                kind: row.kind,
                status: row.status,
                projectId: row.projectId,
                agentId: row.agentId,
                payload: row.payload,
                base: row.base,
              },
            ]
          : [],
      );
    }
    if (text.startsWith("UPDATE app.chat_proposals SET status = 'applied'")) {
      const row = proposals.get(String(values[2]));
      if (row !== undefined) {
        row.status = 'applied';
        row.result = values[0];
        row.decidedAt = Number(values[1]);
      }
      return Promise.resolve([]);
    }
    if (text.startsWith("UPDATE app.chat_proposals SET status = 'failed'")) {
      const row = proposals.get(String(values[2]));
      if (row !== undefined && row.status === 'pending') {
        row.status = 'failed';
        row.result = values[0];
        row.decidedAt = Number(values[1]);
      }
      return Promise.resolve([]);
    }
    if (text.startsWith("UPDATE app.chat_proposals SET status = 'dismissed'")) {
      const row = proposals.get(String(values[1]));
      if (row !== undefined) {
        row.status = 'dismissed';
        row.decidedAt = Number(values[0]);
      }
      return Promise.resolve([]);
    }
    if (text.includes('FROM app.chat_proposals p')) {
      // The first value is the column list (`sql.unsafe`); the id follows.
      const row = proposals.get(String(values[1]));
      return Promise.resolve(row === undefined ? [] : [viewRow(row)]);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve([
        {
          name: AGENT.name,
          harness: AGENT.harness,
          model: AGENT.model,
          modelProvider: AGENT.modelProvider,
          skills: AGENT.skills,
          connectors: AGENT.connectors,
          tools: AGENT.tools,
          secrets: AGENT.secrets,
          instructions: AGENT.instructions,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(run, {
    json: (value: unknown) => value,
    unsafe: (text: string) => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: sql as unknown as Sql, proposals };
}

const auth = (role = 'editor') => ({
  organizationId: ORG,
  userId: MIA,
  role,
  teamIds: [],
});

async function settingsFor(
  sql: Sql,
  projectId: string | null = null,
): Promise<ChatToolExecutor> {
  const tools = await chatSettingsTools(sql, {
    organizationId: ORG,
    userId: MIA,
    rootThreadId: CHAT,
    projectId,
  });
  if (tools === undefined) throw new Error('no settings tools');
  return tools.executor;
}

const propose = (executor: ChatToolExecutor, input: Record<string, unknown>) =>
  executor.execute({ id: 'call-1', name: 'propose_project_settings', input });

beforeEach(() => {
  mocks.findActingMember.mockResolvedValue({ role: 'editor' });
  mocks.getProjectAuthContext.mockImplementation(
    (_sql: unknown, member: { role: string }) =>
      Promise.resolve(auth(member.role)),
  );
  mocks.listProjects.mockResolvedValue([PROJECT]);
  mocks.getProject.mockResolvedValue(PROJECT);
  mocks.listProjectAgents.mockResolvedValue([AGENT]);
  mocks.listChatAgents.mockResolvedValue([{ id: AGENT.id, name: AGENT.name }]);
  mocks.listComposerModels.mockResolvedValue({
    models: [MODEL, RESPONSES_MODEL],
    harnesses: HARNESSES,
  });
  mocks.listProjectCapabilities.mockResolvedValue({
    skills: [{ slug: 'docx' }, { slug: 'pdf' }],
  });
  mocks.runInRequestChannel.mockImplementation(
    (_channel: unknown, run: () => unknown) => run(),
  );
  mocks.resolveProjectKey.mockResolvedValue('LS');
  mocks.createProject.mockResolvedValue('project-new');
  mocks.createProjectAgent.mockResolvedValue('agent-new');
  mocks.loadProjectOrThrow.mockResolvedValue(PROJECT);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the settings tools [CHAT-R45]', () => {
  it('are offered to a person who may change projects, and to a Member not at all', async () => {
    const { sql } = fakeSql();
    const editor = await chatSettingsTools(sql, {
      organizationId: ORG,
      userId: MIA,
      rootThreadId: CHAT,
      projectId: null,
    });
    mocks.findActingMember.mockResolvedValue({ role: 'member' });
    const member = await chatSettingsTools(sql, {
      organizationId: ORG,
      userId: MIA,
      rootThreadId: CHAT,
      projectId: null,
    });
    expect(editor?.executor.wireTools.map((tool) => tool.name)).toEqual([
      'read_project_settings',
      'propose_project_settings',
    ]);
    expect(member).toBeUndefined();
  });

  it('are offered to no API key: a proposal is a card a person applies in the app', async () => {
    const { sql } = fakeSql();
    mocks.findActingMember.mockResolvedValue({
      role: 'editor',
      apiKeyOwner: { kind: 'project', projectId: PROJECT.id },
    });
    expect(
      await chatSettingsTools(sql, {
        organizationId: ORG,
        userId: 'key-user',
        rootThreadId: CHAT,
        projectId: null,
      }),
    ).toBeUndefined();
  });

  it('reach only the project a chat is filed in, besides a new project', async () => {
    const { sql, proposals } = fakeSql();
    const OTHER = { ...PROJECT, id: 'project-2', name: 'Finance', key: 'FIN' };
    mocks.listProjects.mockResolvedValue([PROJECT, OTHER]);
    const executor = await settingsFor(sql, PROJECT.id);
    const listed = await executor.execute({
      id: 'call-1',
      name: 'read_project_settings',
      input: {},
    });
    const readElsewhere = await executor.execute({
      id: 'call-2',
      name: 'read_project_settings',
      input: { project: 'Finance' },
    });
    const changeElsewhere = await propose(executor, {
      change: 'update_project',
      project: 'Finance',
      description: 'Numbers.',
    });
    const created = await propose(executor, {
      change: 'create_project',
      name: 'Launch site',
    });
    expect(listed).toMatchObject({
      status: 'ok',
      projects: [{ id: PROJECT.id }],
    });
    expect((listed as { projects: unknown[] }).projects).toHaveLength(1);
    expect(readElsewhere).toMatchObject({ status: 'invalid_args' });
    // Refused without naming the person's other projects.
    expect(readElsewhere).not.toHaveProperty('closest');
    expect(changeElsewhere).toMatchObject({ status: 'invalid_args' });
    expect(created).toMatchObject({ status: 'ok' });
    expect([...proposals.values()].map((row) => row.kind)).toEqual([
      'create_project',
    ]);
  });

  it('refuse a change they do not know, such as a deletion', async () => {
    const { sql, proposals } = fakeSql();
    const answer = await propose(await settingsFor(sql), {
      change: 'delete_project',
      project: 'Website relaunch',
    });
    expect(answer).toMatchObject({ status: 'invalid_args' });
    expect(proposals.size).toBe(0);
  });

  it('refuse a project the person cannot change, and keep nothing', async () => {
    const { sql, proposals } = fakeSql();
    mocks.listProjects.mockResolvedValue([{ ...PROJECT, canEdit: false }]);
    const answer = await propose(await settingsFor(sql), {
      change: 'update_project',
      project: 'Website relaunch',
      description: 'Another site.',
    });
    expect(answer).toMatchObject({ status: 'invalid_args' });
    expect(proposals.size).toBe(0);
  });
});

describe('a proposal [CHAT-R44]', () => {
  it('keeps a new project as a pending proposal with the key the create would give it, and makes nothing', async () => {
    const { sql, proposals } = fakeSql();
    const answer = await propose(await settingsFor(sql), {
      change: 'create_project',
      name: 'Launch site',
      description: 'The spring microsite.',
    });
    expect(answer).toMatchObject({
      status: 'ok',
      proposalId: 'proposal-1',
      change: 'create_project',
      fields: [
        { field: 'name', value: 'Launch site' },
        { field: 'key', value: 'LS' },
        { field: 'description', value: 'The spring microsite.' },
      ],
    });
    expect(proposals.get('proposal-1')).toMatchObject({
      status: 'pending',
      threadId: CHAT,
      userId: MIA,
      payload: {
        name: 'Launch site',
        key: 'LS',
        description: 'The spring microsite.',
      },
    });
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('names a new agent’s model by its label and takes a runtime that runs it', async () => {
    const { sql, proposals } = fakeSql();
    const answer = await propose(await settingsFor(sql), {
      change: 'create_agent',
      project: 'website relaunch',
      name: 'Proofreader',
      model: 'Responses Model',
      skills: ['PDF'],
    });
    expect(answer).toMatchObject({ status: 'ok' });
    expect(proposals.get('proposal-1')?.payload).toMatchObject({
      name: 'Proofreader',
      model: 'responses-model',
      modelProvider: 'gateway',
      // Claude Code's wire does not carry this model's tools; Codex's does.
      harness: 'codex',
      skills: ['pdf'],
    });
  });

  it('gives a new agent named without skills the document skills the project can equip', async () => {
    const { sql, proposals } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'create_agent',
      project: 'Website relaunch',
      name: 'Proofreader',
      model: 'chat-model',
    });
    // As the Agents tab's New agent ticks them: docx and pdf here, the
    // document skills the project's capabilities list.
    expect(proposals.get('proposal-1')?.payload).toMatchObject({
      skills: ['docx', 'pdf'],
    });
  });

  it('refuses a skill the project cannot equip, naming the closest', async () => {
    const { sql, proposals } = fakeSql();
    const answer = await propose(await settingsFor(sql), {
      change: 'create_agent',
      project: 'Website relaunch',
      name: 'Proofreader',
      model: 'chat-model',
      skills: ['doc'],
    });
    expect(answer).toMatchObject({
      status: 'invalid_args',
      closest: ['docx'],
    });
    expect(proposals.size).toBe(0);
  });

  it('refuses a change that would change nothing', async () => {
    const { sql, proposals } = fakeSql();
    const answer = await propose(await settingsFor(sql), {
      change: 'update_agent',
      project: 'Website relaunch',
      agent: 'Copy reviewer',
      instructions: AGENT.instructions,
    });
    expect(answer).toMatchObject({ status: 'invalid_args' });
    expect(proposals.size).toBe(0);
  });

  it('is applied once, as the person, in a request channel that names the chat', async () => {
    const { sql } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'create_agent',
      project: 'Website relaunch',
      name: 'Proofreader',
      model: 'chat-model',
      instructions: 'Check spelling.',
    });
    const args = {
      organizationId: ORG,
      userId: MIA,
      role: 'editor',
      proposalId: 'proposal-1',
    };
    const first = await applyProposal(sql, args);
    const again = await applyProposal(sql, args);
    expect(first).toMatchObject({
      status: 'applied',
      projectId: PROJECT.id,
      agentId: 'agent-new',
    });
    expect(again.status).toBe('applied');
    expect(mocks.createProjectAgent).toHaveBeenCalledTimes(1);
    expect(mocks.createProjectAgent).toHaveBeenCalledWith(
      sql,
      auth('editor'),
      expect.objectContaining({
        projectId: PROJECT.id,
        name: 'Proofreader',
        harness: 'claude-code',
        model: 'chat-model',
        modelProvider: 'gateway',
        instructions: 'Check spelling.',
        connectors: [],
      }),
    );
    expect(mocks.runInRequestChannel).toHaveBeenCalledWith(
      { via: 'chat', threadId: CHAT, proposalId: 'proposal-1' },
      expect.any(Function),
    );
  });

  it('pays the create-project rate charge before it creates a project', async () => {
    const { sql } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'create_project',
      name: 'Launch site',
      instructions: 'Keep it short.',
    });
    const applied = await applyProposal(sql, {
      organizationId: ORG,
      userId: MIA,
      role: 'editor',
      proposalId: 'proposal-1',
    });
    expect(applied.status).toBe('applied');
    expect(mocks.checkUserRateLimit).toHaveBeenCalledWith(
      sql,
      'project:create',
      MIA,
    );
    expect(mocks.createProject).toHaveBeenCalledWith(sql, auth('editor'), {
      name: 'Launch site',
      key: 'LS',
    });
    expect(mocks.ensureDefaultProjectLabels).toHaveBeenCalled();
    expect(mocks.updateProjectInstructions).toHaveBeenCalledWith(
      sql,
      auth('editor'),
      'project-new',
      'Keep it short.',
    );
  });

  it('is someone else’s to decide only if it is theirs', async () => {
    const { sql } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'create_project',
      name: 'Launch site',
    });
    await expect(
      applyProposal(sql, {
        organizationId: ORG,
        userId: 'user-noah',
        role: 'admin',
        proposalId: 'proposal-1',
      }),
    ).rejects.toBeInstanceOf(ProposalError);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('dismissed, stays dismissed and makes nothing', async () => {
    const { sql } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'create_project',
      name: 'Launch site',
    });
    const args = {
      organizationId: ORG,
      userId: MIA,
      proposalId: 'proposal-1',
    };
    const dismissed = await dismissProposal(sql, args);
    const applied = await applyProposal(sql, { ...args, role: 'editor' });
    expect(dismissed.status).toBe('dismissed');
    expect(applied.status).toBe('dismissed');
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
});

describe('an apply over a change made since [CHAT-R46]', () => {
  it('fails as stale when the agent changed since, and says so', async () => {
    const { sql } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'update_agent',
      project: 'Website relaunch',
      agent: 'Copy reviewer',
      name: 'Copy editor',
    });
    mocks.updateProjectAgent.mockRejectedValue(
      new ProjectError(
        'PROJECT_AGENT_STALE',
        'The agent changed since it was read',
        409,
      ),
    );
    const applied = await applyProposal(sql, {
      organizationId: ORG,
      userId: MIA,
      role: 'editor',
      proposalId: 'proposal-1',
    });
    expect(mocks.updateProjectAgent).toHaveBeenCalledWith(
      sql,
      auth('editor'),
      expect.objectContaining({
        agentId: AGENT.id,
        name: 'Copy editor',
        expectedUpdatedAt: AGENT.updatedAt,
      }),
    );
    expect(applied).toMatchObject({
      status: 'failed',
      failure: { code: 'PROJECT_AGENT_STALE', reason: 'stale' },
    });
  });

  it('refuses a project field edited since without writing anything', async () => {
    const { sql } = fakeSql();
    await propose(await settingsFor(sql), {
      change: 'update_project',
      project: 'Website relaunch',
      name: 'Website 2027',
    });
    mocks.loadProjectOrThrow.mockResolvedValue({
      ...PROJECT,
      name: 'Website relaunch (renamed)',
    });
    const applied = await applyProposal(sql, {
      organizationId: ORG,
      userId: MIA,
      role: 'editor',
      proposalId: 'proposal-1',
    });
    expect(applied).toMatchObject({
      status: 'failed',
      failure: { code: 'PROPOSAL_STALE', reason: 'stale' },
    });
    expect(mocks.updateProjectIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['PROPOSAL_STALE', 'stale'],
    ['PROJECT_CHAT_AGENT_STALE', 'stale'],
    ['PROJECT_AGENT_NOT_FOUND', 'gone'],
    ['PROJECT_NOT_FOUND', 'gone'],
    ['PROJECT_ARCHIVED', 'archived'],
    ['PROJECT_KEY_TAKEN', 'keyTaken'],
    ['PROJECT_AGENT_NAME_TAKEN', 'nameTaken'],
    ['PROJECT_AGENT_MODEL_INVALID', 'model'],
    ['PROJECT_AGENT_PROVIDER_UNKNOWN', 'model'],
    ['PROJECT_AGENT_SKILL_UNKNOWN', 'skills'],
    ['PROJECT_AGENT_LIMIT', 'limit'],
    ['RBAC_FORBIDDEN', 'forbidden'],
    ['PROJECT_FORBIDDEN', 'forbidden'],
    ['TEAM_ACCESS_DENIED', 'forbidden'],
    ['PROJECT_NAME_INVALID', 'invalid'],
  ])('says %s as %s', (code, reason) => {
    expect(proposalFailureOf(code)).toBe(reason);
  });
});

describe('a proposal as its card shows it', () => {
  it('names who answers in new chats in a shape the card puts in the person’s language', async () => {
    const { sql, proposals } = fakeSql();
    mocks.listChatAgents.mockResolvedValue([
      { id: AGENT.id, name: AGENT.name },
      { id: 'agent-2', name: 'Coder' },
    ]);
    await propose(await settingsFor(sql), {
      change: 'update_project',
      project: 'Website relaunch',
      defaultChatAgent: 'assistant',
    });
    const row = proposals.get('proposal-1');
    const view = viewOf({
      id: 'proposal-1',
      kind: 'update_project',
      status: 'pending',
      projectId: PROJECT.id,
      agentId: null,
      payload: row?.payload,
      base: row?.base,
      result: null,
      createdAt: 1,
      decidedAt: null,
      projectName: PROJECT.name,
      agentName: null,
    });
    expect(view.fields).toEqual([
      {
        field: 'defaultChatAgent',
        value: 'Assistant',
        before: 'First agent created (Copy reviewer)',
        chatAgent: { kind: 'assistant' },
        chatAgentBefore: { kind: 'first', name: 'Copy reviewer' },
      },
    ]);
  });

  it('shows each changed field with what it replaces, and a new agent without skills without a skills row', () => {
    const base = {
      id: 'proposal-1',
      status: 'pending' as const,
      result: null,
      createdAt: 1,
      decidedAt: null,
      projectName: null,
      agentName: null,
    };
    const change = viewOf({
      ...base,
      kind: 'update_agent',
      projectId: PROJECT.id,
      agentId: AGENT.id,
      payload: { name: 'Copy editor', skills: [] },
      base: { name: 'Copy reviewer', skills: ['docx'], instructions: null },
    });
    const created = viewOf({
      ...base,
      kind: 'create_agent',
      projectId: PROJECT.id,
      agentId: null,
      payload: {
        name: 'Proofreader',
        modelLabel: 'Chat Model · Gateway',
        harnessLabel: 'Claude Code',
        skills: [],
      },
      base: null,
    });
    expect(change.fields).toEqual([
      { field: 'name', value: 'Copy editor', before: 'Copy reviewer' },
      { field: 'skills', value: '', before: 'docx' },
    ]);
    expect(created.fields.map((field) => field.field)).toEqual([
      'name',
      'model',
      'runtime',
    ]);
    expect(created.agentName).toBe('Proofreader');
  });
});
