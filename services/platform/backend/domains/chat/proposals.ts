import { transactSerializable } from '@tale/shared/db/serializable';
import {
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_NAME_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_NAME_MAX,
  projectChatAgentFrom,
  type ProjectChatAgent,
  projectChatAgentSchema,
  sameProjectChatAgent,
} from '@tale/shared/schemas/projects';
import type { Sql, TransactionSql } from 'postgres';

import type { ToolDoc } from '../../../lib/chat/context.ts';
import {
  type ChatProposalView,
  isSettingsToolName,
  PROPOSAL_KINDS,
  type ProposalChatAgent,
  type ProposalFailure,
  type ProposalField,
  type ProposalKind,
  READ_PROJECT_SETTINGS,
  SETTINGS_TOOL_DOCS,
  SETTINGS_WIRE_TOOLS,
} from '../../../lib/chat/settings-tools.ts';
import type {
  ChatToolExecutor,
  ToolCallRequest,
} from '../../../lib/chat/tools.ts';
import { DOCUMENT_SKILL_SLUGS } from '../../../lib/shared/document-skills.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { findActingMember } from '../../auth/membership.ts';
import type { ComposerModelOption } from '../../core/chat/composer.ts';
import { EDITOR_ROLES } from '../../core/lib/audience.ts';
import { toJson } from '../../db/sql.ts';
import { checkUserRateLimit } from '../../lib/rate-limit.ts';
import { runInRequestChannel } from '../../lib/request-channel.ts';
import { harnessRunsOption } from '../projects/agent-equipment.ts';
import {
  assertCanCreateProjects,
  createProject,
  createProjectAgent,
  getProject,
  getProjectAuthContext,
  listProjectAgents,
  listProjects,
  loadProjectOrThrow,
  type ProjectAuthContext,
  ProjectError,
  type ProjectListRow,
  resolveProjectKey,
  setProjectChatAgent,
  updateProjectAgent,
  updateProjectIdentity,
  updateProjectInstructions,
} from '../projects/service.ts';
import { ensureDefaultProjectLabels } from '../tasks/service.ts';
import { listChatAgents } from './agents.ts';
import {
  type ComposerHarnessRow,
  listComposerModels,
  listProjectCapabilities,
} from './composer.ts';

/**
 * Changes to projects and agents a chat proposes, for the person to apply.
 *
 * The chat's two settings tools (`lib/chat/settings-tools.ts`) act for the
 * person chatting. `read_project_settings` reads what they can open. With
 * `propose_project_settings` the model drafts one change; it is checked
 * here as the person — their role, the project's access and archive state,
 * the names, the model and runtime they may use, the skills the project can
 * equip — and kept as a proposal (`app.chat_proposals`, migration 0237),
 * which the reply shows as a card. Nothing is written to the project or the
 * agent until the person applies the card: the apply checks everything
 * again, as them, through the same services the pages use, and records the
 * outcome on the proposal. The audit rows the services write say the change
 * came from a chat (`via: 'chat'`), with the conversation and the proposal.
 *
 * What a proposal can change is deliberately narrow: names, descriptions,
 * instructions, a project's default chat agent, an agent's model, runtime
 * (on creation) and skills. Sharing, secrets, connectors, tool grants,
 * repository access and deletion are a person's own work on the pages.
 */

/** Projects a read lists, at most: enough to choose from. */
const READ_PROJECTS_MAX = 50;
/** Names a refusal offers as the closest. */
const CLOSEST_MAX = 8;

export interface SettingsTurn {
  readonly organizationId: string;
  readonly userId: string;
  /** The conversation's root: the proposals belong to the conversation. */
  readonly rootThreadId: string;
  /** The project the chat is filed in: the tools reach that project alone,
   * as the chat's retrieval does, besides proposing a new project. Null
   * for a chat outside projects, which reaches every project the person
   * can open. */
  readonly projectId: string | null;
}

/** A tool answer the model reads; never thrown. */
type ToolAnswer = Record<string, unknown>;

function refused(message: string, closest?: readonly string[]): ToolAnswer {
  return {
    status: 'invalid_args',
    message,
    ...(closest !== undefined && closest.length > 0 ? { closest } : {}),
  };
}

const trimmed = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** The closest of `names` to `wanted`: those containing it, then those it
 * contains, case-blind. */
function closestNames(names: readonly string[], wanted: string): string[] {
  const needle = wanted.toLowerCase();
  const scored = names
    .map((name) => {
      const hay = name.toLowerCase();
      return {
        name,
        score:
          hay === needle
            ? 0
            : hay.includes(needle)
              ? 1
              : needle.includes(hay)
                ? 2
                : 3,
      };
    })
    .filter((entry) => entry.score < 3)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, CLOSEST_MAX).map((entry) => entry.name);
}

/** The one row of `rows` that `wanted` names by id or name (and key, for a
 * project), case-blind; a refusal sentence when none or several do. */
function pick<T extends { id: string; name: string; key?: string | null }>(
  rows: readonly T[],
  wanted: string,
  noun: string,
): T | ToolAnswer {
  const needle = wanted.toLowerCase();
  const exact = rows.filter(
    (row) =>
      row.id === wanted ||
      row.name.toLowerCase() === needle ||
      (row.key ?? '').toLowerCase() === needle,
  );
  if (exact.length === 1 && exact[0] !== undefined) return exact[0];
  if (exact.length > 1) {
    return refused(
      `Several ${noun}s are called "${wanted}"; name one by its id.`,
      exact.map((row) => `${row.name} (${row.id})`),
    );
  }
  return refused(
    `No ${noun} the person can open is called "${wanted}".`,
    closestNames(
      rows.map((row) => row.name),
      wanted,
    ),
  );
}

const isAnswer = (value: unknown): value is ToolAnswer =>
  value !== null &&
  typeof value === 'object' &&
  'status' in value &&
  (value as { status?: unknown }).status === 'invalid_args';

/** The model `wanted` names among those the person may use for agents. */
function pickModel(
  models: readonly ComposerModelOption[],
  wanted: string,
): ComposerModelOption | ToolAnswer {
  const needle = wanted.toLowerCase();
  const byId = models.filter((model) => model.id.toLowerCase() === needle);
  const byLabel = models.filter(
    (model) => model.label.toLowerCase() === needle,
  );
  const exact = byId.length > 0 ? byId : byLabel;
  if (exact[0] !== undefined) return exact[0];
  const loose = models.filter(
    (model) =>
      model.label.toLowerCase().includes(needle) ||
      model.id.toLowerCase().includes(needle),
  );
  if (loose.length === 1 && loose[0] !== undefined) return loose[0];
  return refused(
    loose.length > 1
      ? `Several models match "${wanted}"; name one exactly.`
      : `No model the person may use is called "${wanted}".`,
    (loose.length > 1 ? loose : models)
      .slice(0, CLOSEST_MAX)
      .map((model) => `${model.label} (${model.id}, ${model.providerLabel})`),
  );
}

interface Payloads {
  create_project: {
    name: string;
    key?: string;
    description?: string;
    instructions?: string;
  };
  update_project: {
    name?: string;
    description?: string;
    instructions?: string;
    chatAgent?: ProjectChatAgent;
    chatAgentLabel?: string;
    chatAgentView?: ProposalChatAgent;
  };
  create_agent: {
    name: string;
    harness: string;
    harnessLabel: string;
    model: string;
    modelProvider: string;
    modelLabel: string;
    skills: string[];
    instructions?: string;
  };
  update_agent: {
    name?: string;
    instructions?: string;
    model?: string;
    modelProvider?: string;
    modelLabel?: string;
    skills?: string[];
  };
}

interface Bases {
  update_project: {
    name: string;
    description: string | null;
    instructions: string | null;
    chatAgent: ProjectChatAgent;
    chatAgentLabel: string;
    chatAgentView: ProposalChatAgent;
  };
  update_agent: {
    name: string;
    instructions: string | null;
    model: string;
    modelProvider: string | null;
    modelLabel: string;
    skills: string[];
    updatedAt: number;
  };
}

/** Who a project's new chats answer as, named: the card's value, which it
 * puts in the person's language, and the sentence the model reads. A
 * chosen agent that is gone reads as the first agent created, as the
 * server reads it. */
function chatAgentView(
  choice: ProjectChatAgent,
  agents: readonly { id: string; name: string }[],
): ProposalChatAgent {
  if (choice.kind === 'assistant') return { kind: 'assistant' };
  if (choice.kind === 'agent') {
    const named = agents.find((agent) => agent.id === choice.agentId);
    if (named !== undefined) return { kind: 'agent', name: named.name };
  }
  const first = agents[0];
  return first === undefined
    ? { kind: 'first' }
    : { kind: 'first', name: first.name };
}

function chatAgentLabel(view: ProposalChatAgent): string {
  if (view.kind === 'assistant') return 'Assistant';
  if (view.kind === 'agent') return view.name;
  return view.name === undefined
    ? 'First agent created'
    : `First agent created (${view.name})`;
}

/** A stored card value read back; nothing for a shape it does not know. */
function chatAgentViewOf(value: unknown): ProposalChatAgent | undefined {
  const view = record(value);
  if (view.kind === 'assistant') return { kind: 'assistant' };
  if (view.kind === 'agent' && typeof view.name === 'string') {
    return { kind: 'agent', name: view.name };
  }
  if (view.kind === 'first') {
    return typeof view.name === 'string'
      ? { kind: 'first', name: view.name }
      : { kind: 'first' };
  }
  return undefined;
}

/** The refusal for a project outside the chat's own. */
function outOfScope(
  projects: readonly ProjectListRow[],
  scope: string,
  wanted: string,
): ToolAnswer {
  const own = projects.find((project) => project.id === scope);
  return refused(
    own === undefined
      ? `This chat is filed in a project of its own: only that project is in reach here. Ask about "${wanted}" in a chat outside projects.`
      : `This chat is filed in ${own.name}: only that project is in reach here. Ask about "${wanted}" in a chat outside projects.`,
  );
}

/** The project `wanted` names among those a chat may reach: in a chat
 * filed in a project, that project alone — a name that is not it is
 * refused without offering any other project's name. */
function pickInScope(
  projects: readonly ProjectListRow[],
  wanted: string,
  scope: string | null,
): ProjectListRow | ToolAnswer {
  if (scope === null) return pick(projects, wanted, 'project');
  const own = projects.filter((project) => project.id === scope);
  const project = pick(own, wanted, 'project');
  return isAnswer(project) ? outOfScope(projects, scope, wanted) : project;
}

interface Proposed {
  kind: ProposalKind;
  projectId: string | null;
  agentId: string | null;
  payload: unknown;
  base: unknown;
}

/** The settings tools of a turn, for a person who may create projects or
 * change one; none for anyone else. */
export async function chatSettingsTools(
  sql: Sql,
  turn: SettingsTurn,
): Promise<
  { executor: ChatToolExecutor; toolDocs: readonly ToolDoc[] } | undefined
> {
  const member = await findActingMember(sql, turn.organizationId, turn.userId);
  // An API key's own identity gets none: a proposal is a card a person
  // applies in the app, and a project's key reaches its project alone.
  if (
    member === null ||
    member.apiKeyOwner !== undefined ||
    !EDITOR_ROLES.has(member.role)
  ) {
    return undefined;
  }
  const authFor = () =>
    getProjectAuthContext(sql, {
      organizationId: turn.organizationId,
      userId: turn.userId,
      role: member.role,
    });
  const executor: ChatToolExecutor = {
    wireTools: SETTINGS_WIRE_TOOLS,
    async execute(call: ToolCallRequest): Promise<unknown> {
      if (!isSettingsToolName(call.name)) {
        return refused(`${call.name} is not a settings tool.`);
      }
      try {
        const auth = await authFor();
        const input = record(call.input);
        return call.name === READ_PROJECT_SETTINGS
          ? await readSettings(sql, auth, input, turn.projectId)
          : await propose(sql, auth, turn, input);
      } catch (error) {
        if (error instanceof ProjectError) {
          return refused(error.message);
        }
        console.error(`[chat] ${call.name} failed:`, error);
        return {
          status: 'error',
          message: 'The settings could not be read; try again in a moment.',
        };
      }
    },
  };
  return { executor, toolDocs: SETTINGS_TOOL_DOCS };
}

async function readSettings(
  sql: Sql,
  auth: ProjectAuthContext,
  input: Record<string, unknown>,
  scope: string | null,
): Promise<ToolAnswer> {
  const projectWanted = trimmed(input.project);
  const agentWanted = trimmed(input.agent);
  const projects = await listProjects(sql, auth);
  if (projectWanted === undefined) {
    if (agentWanted !== undefined) {
      return refused('Name the project the agent belongs to.');
    }
    const listed =
      scope === null
        ? projects
        : projects.filter((project) => project.id === scope);
    return {
      status: 'ok',
      canCreateProjects: EDITOR_ROLES.has(auth.role),
      projects: listed.slice(0, READ_PROJECTS_MAX).map((project) => {
        const row: Record<string, unknown> = {
          id: project.id,
          name: project.name,
          canChange: project.canEdit,
        };
        if (project.key !== null && project.key !== undefined) {
          row.key = project.key;
        }
        return row;
      }),
      ...(listed.length > READ_PROJECTS_MAX
        ? { omitted: listed.length - READ_PROJECTS_MAX }
        : {}),
    };
  }
  const project = pickInScope(projects, projectWanted, scope);
  if (isAnswer(project)) return project;
  const agents = (await listProjectAgents(sql, auth, project.id)).filter(
    (agent) => !agent.managed,
  );
  if (agentWanted !== undefined) {
    const agent = pick(agents, agentWanted, 'agent');
    if (isAnswer(agent)) return agent;
    return {
      status: 'ok',
      agent: {
        id: agent.id,
        name: agent.name,
        runtime: agent.harness,
        model: agent.model,
        ...(agent.modelProvider !== null
          ? { provider: agent.modelProvider }
          : {}),
        skills: agent.skills,
        instructions: agent.instructions ?? '',
        canChange: project.canEdit,
      },
    };
  }
  const choice = projectChatAgentFrom(project);
  return {
    status: 'ok',
    project: {
      id: project.id,
      name: project.name,
      ...(project.key !== null && project.key !== undefined
        ? { key: project.key }
        : {}),
      description: project.description ?? '',
      instructions: project.instructions ?? '',
      defaultChatAgent: chatAgentLabel(chatAgentView(choice, agents)),
      canChange: project.canEdit,
      archived: project.archivedAt !== null,
    },
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      runtime: agent.harness,
      model: agent.model,
      skills: agent.skills,
      hasInstructions: (agent.instructions ?? '').trim() !== '',
    })),
  };
}

/** A text field a proposal sets: trimmed, at most `max` characters. */
function textField(
  input: Record<string, unknown>,
  field: string,
  max: number,
): string | undefined | ToolAnswer {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return refused(`"${field}" must be text.`);
  const text = field === 'instructions' ? value : value.trim();
  if (text.length > max) {
    return refused(`"${field}" is ${text.length} characters; at most ${max}.`);
  }
  return text;
}

async function propose(
  sql: Sql,
  auth: ProjectAuthContext,
  turn: SettingsTurn,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const kind = input.change;
  if (
    typeof kind !== 'string' ||
    !(PROPOSAL_KINDS as readonly string[]).includes(kind)
  ) {
    return refused(`"change" must be one of ${PROPOSAL_KINDS.join(', ')}.`);
  }
  const proposed =
    kind === 'create_project'
      ? await proposeCreateProject(sql, auth, input)
      : kind === 'update_project'
        ? await proposeUpdateProject(sql, auth, input, turn.projectId)
        : kind === 'create_agent'
          ? await proposeCreateAgent(sql, auth, input, turn.projectId)
          : await proposeUpdateAgent(sql, auth, input, turn.projectId);
  if (isAnswer(proposed)) return proposed;
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.chat_proposals (
      org_id, thread_id, user_id, kind, project_id, agent_id, payload, base,
      status, created_at_ms
    ) VALUES (
      ${auth.organizationId}, ${turn.rootThreadId}, ${auth.userId},
      ${proposed.kind}, ${proposed.projectId}, ${proposed.agentId},
      ${sql.json(toJson(proposed.payload))},
      ${proposed.base === null ? null : sql.json(toJson(proposed.base))},
            'pending', ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('proposal insert failed');
  const view = viewOf({
    id,
    kind: proposed.kind,
    status: 'pending',
    projectId: proposed.projectId,
    agentId: proposed.agentId,
    payload: proposed.payload,
    base: proposed.base,
    result: null,
    createdAt: now,
    decidedAt: null,
    projectName: null,
    agentName: null,
  });
  return {
    status: 'ok',
    proposalId: id,
    change: proposed.kind,
    fields: view.fields,
    message:
      'Proposed, not applied: the person sees this change as a card under your reply and applies or dismisses it there. Say what you proposed; never say it is done.',
  };
}

async function proposeCreateProject(
  sql: Sql,
  auth: ProjectAuthContext,
  input: Record<string, unknown>,
): Promise<Proposed | ToolAnswer> {
  if (!EDITOR_ROLES.has(auth.role)) {
    return refused(
      'The person cannot create projects: an Editor or an Admin can.',
    );
  }
  const name = textField(input, 'name', PROJECT_NAME_MAX);
  if (isAnswer(name)) return name;
  if (name === undefined || name === '') {
    return refused('A new project needs a "name".');
  }
  const description = textField(input, 'description', PROJECT_DESCRIPTION_MAX);
  if (isAnswer(description)) return description;
  const instructions = textField(
    input,
    'instructions',
    PROJECT_INSTRUCTIONS_MAX_CHARS,
  );
  if (isAnswer(instructions)) return instructions;
  // The key the project gets, by the create's own rule: the one asked
  // for, else one derived from the name — so the card shows it, and a
  // taken one is refused now rather than at the apply.
  const key = await resolveProjectKey(
    sql,
    auth.organizationId,
    trimmed(input.key),
    name,
  );
  return {
    kind: 'create_project',
    projectId: null,
    agentId: null,
    payload: {
      name,
      ...(key !== undefined ? { key } : {}),
      ...(description !== undefined && description !== ''
        ? { description }
        : {}),
      ...(instructions !== undefined && instructions.trim() !== ''
        ? { instructions }
        : {}),
    } satisfies Payloads['create_project'],
    base: null,
  };
}

/** The project `wanted` names, which the person may change and the chat
 * may reach. */
async function changeableProject(
  sql: Sql,
  auth: ProjectAuthContext,
  wanted: unknown,
  scope: string | null,
): Promise<ProjectListRow | ToolAnswer> {
  const name = trimmed(wanted);
  if (name === undefined) return refused('Name the "project".');
  const projects = await listProjects(sql, auth);
  const project = pickInScope(projects, name, scope);
  if (isAnswer(project)) return project;
  if (!project.canEdit) {
    return refused(
      `The person cannot change ${project.name}: an Editor or Admin of the project can.`,
    );
  }
  return getProject(sql, auth, project.id);
}

async function proposeUpdateProject(
  sql: Sql,
  auth: ProjectAuthContext,
  input: Record<string, unknown>,
  scope: string | null,
): Promise<Proposed | ToolAnswer> {
  const project = await changeableProject(sql, auth, input.project, scope);
  if (isAnswer(project)) return project;
  const name = textField(input, 'name', PROJECT_NAME_MAX);
  if (isAnswer(name)) return name;
  const description = textField(input, 'description', PROJECT_DESCRIPTION_MAX);
  if (isAnswer(description)) return description;
  const instructions = textField(
    input,
    'instructions',
    PROJECT_INSTRUCTIONS_MAX_CHARS,
  );
  if (isAnswer(instructions)) return instructions;
  const agents = await listChatAgents(sql, {
    organizationId: auth.organizationId,
    projectId: project.id,
  });
  let chatAgent: ProjectChatAgent | undefined;
  const wantedDefault = trimmed(input.defaultChatAgent);
  if (wantedDefault !== undefined) {
    const lowered = wantedDefault.toLowerCase();
    if (lowered === 'first') chatAgent = { kind: 'first' };
    else if (lowered === 'assistant') chatAgent = { kind: 'assistant' };
    else {
      const agent = pick(agents, wantedDefault, 'agent');
      if (isAnswer(agent)) return agent;
      chatAgent = { kind: 'agent', agentId: agent.id };
    }
  }
  const current = projectChatAgentFrom(project);
  const payload: Payloads['update_project'] = {
    ...(name !== undefined && name !== '' && name !== project.name
      ? { name }
      : {}),
    ...(description !== undefined && description !== (project.description ?? '')
      ? { description }
      : {}),
    ...(instructions !== undefined &&
    instructions !== (project.instructions ?? '')
      ? { instructions }
      : {}),
    ...(chatAgent !== undefined && !sameProjectChatAgent(chatAgent, current)
      ? {
          chatAgent,
          chatAgentLabel: chatAgentLabel(chatAgentView(chatAgent, agents)),
          chatAgentView: chatAgentView(chatAgent, agents),
        }
      : {}),
  };
  if (Object.keys(payload).length === 0) {
    return refused(
      'Nothing would change: the project already has these settings.',
    );
  }
  return {
    kind: 'update_project',
    projectId: project.id,
    agentId: null,
    payload,
    base: {
      name: project.name,
      description: project.description ?? null,
      instructions: project.instructions ?? null,
      chatAgent: current,
      chatAgentLabel: chatAgentLabel(chatAgentView(current, agents)),
      chatAgentView: chatAgentView(current, agents),
    } satisfies Bases['update_project'],
  };
}

/** The document skills a new agent starts with: those of
 * {@link DOCUMENT_SKILL_SLUGS} the project can equip. */
async function documentSkillsOf(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<string[]> {
  const { skills } = await listProjectCapabilities(sql, {
    organizationId: auth.organizationId,
    userId: auth.userId,
    projectId,
  });
  const visible = new Set(skills.map((skill) => skill.slug));
  return DOCUMENT_SKILL_SLUGS.filter((slug) => visible.has(slug));
}

/** The skills `wanted` names among those the project can equip. */
async function projectSkills(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
  wanted: unknown,
): Promise<string[] | undefined | ToolAnswer> {
  if (wanted === undefined) return undefined;
  if (
    !Array.isArray(wanted) ||
    !wanted.every((entry): entry is string => typeof entry === 'string')
  ) {
    return refused('"skills" must be a list of skill names.');
  }
  if (wanted.length > PROJECT_AGENT_BINDINGS_MAX) {
    return refused(
      `An agent equips at most ${PROJECT_AGENT_BINDINGS_MAX} skills.`,
    );
  }
  const { skills } = await listProjectCapabilities(sql, {
    organizationId: auth.organizationId,
    userId: auth.userId,
    projectId,
  });
  const available = new Map(
    skills.map((skill) => [skill.slug.toLowerCase(), skill.slug] as const),
  );
  const resolved: string[] = [];
  for (const name of wanted) {
    const slug = available.get(name.trim().toLowerCase());
    if (slug === undefined) {
      return refused(
        `The project cannot equip a skill called "${name}".`,
        closestNames([...available.values()], name.trim()),
      );
    }
    if (!resolved.includes(slug)) resolved.push(slug);
  }
  return resolved;
}

async function proposeCreateAgent(
  sql: Sql,
  auth: ProjectAuthContext,
  input: Record<string, unknown>,
  scope: string | null,
): Promise<Proposed | ToolAnswer> {
  const project = await changeableProject(sql, auth, input.project, scope);
  if (isAnswer(project)) return project;
  const name = textField(input, 'name', PROJECT_AGENT_NAME_MAX);
  if (isAnswer(name)) return name;
  if (name === undefined || name === '') {
    return refused('A new agent needs a "name".');
  }
  const existing = await listProjectAgents(sql, auth, project.id);
  if (
    existing.some((agent) => agent.name.toLowerCase() === name.toLowerCase())
  ) {
    return refused(`${project.name} already has an agent called ${name}.`);
  }
  const instructions = textField(
    input,
    'instructions',
    PROJECT_AGENT_INSTRUCTIONS_MAX,
  );
  if (isAnswer(instructions)) return instructions;
  const { models, harnesses } = await listComposerModels(sql, {
    organizationId: auth.organizationId,
    userId: auth.userId,
  });
  const modelWanted = trimmed(input.model);
  if (modelWanted === undefined) {
    return refused(
      'A new agent needs a "model" the person may use.',
      models.slice(0, CLOSEST_MAX).map((model) => model.label),
    );
  }
  const model = pickModel(models, modelWanted);
  if (isAnswer(model)) return model;
  const runtimeWanted = trimmed(input.runtime);
  let harness: ComposerHarnessRow | undefined;
  if (runtimeWanted !== undefined) {
    const needle = runtimeWanted.toLowerCase();
    harness = harnesses.find(
      (row) =>
        row.harness.toLowerCase() === needle ||
        row.label.toLowerCase() === needle,
    );
    if (harness === undefined) {
      return refused(
        `No agent runtime is called "${runtimeWanted}".`,
        harnesses.map((row) => row.label),
      );
    }
    if (!harnessRunsOption(model, harness.harness, harnesses)) {
      return refused(
        `${harness.label} cannot run ${model.label}.`,
        harnesses
          .filter((row) => harnessRunsOption(model, row.harness, harnesses))
          .map((row) => row.label),
      );
    }
  } else {
    harness = harnesses.find((row) =>
      harnessRunsOption(model, row.harness, harnesses),
    );
    if (harness === undefined) {
      return refused(`No agent runtime can run ${model.label}.`);
    }
  }
  // A new agent named without skills gets the document skills the project
  // can equip, as the Agents tab's New agent ticks them.
  const skills =
    input.skills === undefined
      ? await documentSkillsOf(sql, auth, project.id)
      : await projectSkills(sql, auth, project.id, input.skills);
  if (isAnswer(skills)) return skills;
  return {
    kind: 'create_agent',
    projectId: project.id,
    agentId: null,
    payload: {
      name,
      harness: harness.harness,
      harnessLabel: harness.label,
      model: model.id,
      modelProvider: model.providerSlug,
      modelLabel: `${model.label} · ${model.providerLabel}`,
      skills: skills ?? [],
      ...(instructions !== undefined && instructions.trim() !== ''
        ? { instructions }
        : {}),
    } satisfies Payloads['create_agent'],
    base: null,
  };
}

async function proposeUpdateAgent(
  sql: Sql,
  auth: ProjectAuthContext,
  input: Record<string, unknown>,
  scope: string | null,
): Promise<Proposed | ToolAnswer> {
  const project = await changeableProject(sql, auth, input.project, scope);
  if (isAnswer(project)) return project;
  const agents = await listProjectAgents(sql, auth, project.id);
  const agentWanted = trimmed(input.agent);
  if (agentWanted === undefined) return refused('Name the "agent" to change.');
  const agent = pick(agents, agentWanted, 'agent');
  if (isAnswer(agent)) return agent;
  if (agent.managed) {
    return refused(
      "This is the organization's standard agent; its settings follow the organization's Governance settings.",
    );
  }
  const name = textField(input, 'name', PROJECT_AGENT_NAME_MAX);
  if (isAnswer(name)) return name;
  if (
    name !== undefined &&
    name !== '' &&
    agents.some(
      (other) =>
        other.id !== agent.id &&
        other.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return refused(`${project.name} already has an agent called ${name}.`);
  }
  const instructions = textField(
    input,
    'instructions',
    PROJECT_AGENT_INSTRUCTIONS_MAX,
  );
  if (isAnswer(instructions)) return instructions;
  const { models, harnesses } = await listComposerModels(sql, {
    organizationId: auth.organizationId,
    userId: auth.userId,
  });
  const labelOf = (id: string, provider: string | null): string => {
    const known = models.find(
      (model) =>
        model.id === id &&
        (provider === null || model.providerSlug === provider),
    );
    return known === undefined ? id : `${known.label} · ${known.providerLabel}`;
  };
  let model: ComposerModelOption | undefined;
  const modelWanted = trimmed(input.model);
  if (modelWanted !== undefined) {
    const picked = pickModel(models, modelWanted);
    if (isAnswer(picked)) return picked;
    if (!harnessRunsOption(picked, agent.harness, harnesses)) {
      return refused(
        `${agent.name}'s runtime cannot run ${picked.label}; choose another model, or change the runtime on the project's Agents tab.`,
      );
    }
    model = picked;
  }
  const skills = await projectSkills(sql, auth, project.id, input.skills);
  if (isAnswer(skills)) return skills;
  const sameSkills =
    skills !== undefined &&
    skills.length === agent.skills.length &&
    skills.every((slug, index) => slug === agent.skills[index]);
  const payload: Payloads['update_agent'] = {
    ...(name !== undefined && name !== '' && name !== agent.name
      ? { name }
      : {}),
    ...(instructions !== undefined &&
    instructions !== (agent.instructions ?? '')
      ? { instructions }
      : {}),
    ...(model !== undefined &&
    (model.id !== agent.model || model.providerSlug !== agent.modelProvider)
      ? {
          model: model.id,
          modelProvider: model.providerSlug,
          modelLabel: `${model.label} · ${model.providerLabel}`,
        }
      : {}),
    ...(skills !== undefined && !sameSkills ? { skills } : {}),
  };
  if (Object.keys(payload).length === 0) {
    return refused(
      'Nothing would change: the agent already has these settings.',
    );
  }
  return {
    kind: 'update_agent',
    projectId: project.id,
    agentId: agent.id,
    payload,
    base: {
      name: agent.name,
      instructions: agent.instructions,
      model: agent.model,
      modelProvider: agent.modelProvider,
      modelLabel: labelOf(agent.model, agent.modelProvider),
      skills: agent.skills,
      updatedAt: agent.updatedAt,
    } satisfies Bases['update_agent'],
  };
}

// ---------------------------------------------------------------- reading

interface ProposalRow {
  id: string;
  kind: ProposalKind;
  status: ChatProposalView['status'];
  projectId: string | null;
  agentId: string | null;
  payload: unknown;
  base: unknown;
  result: unknown;
  createdAt: number;
  decidedAt: number | null;
  /** The project's and the agent's names as they stand now, when they exist. */
  projectName: string | null;
  agentName: string | null;
}

const record = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const list = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;

/** A proposal as a card shows it. */
export function viewOf(row: ProposalRow): ChatProposalView {
  const payload = record(row.payload);
  const base = record(row.base);
  const result = record(row.result);
  const fields: ProposalField[] = [];
  const add = (
    field: ProposalField['field'],
    value: string | undefined,
    before?: string,
    extra: Partial<ProposalField> = {},
  ) => {
    if (value === undefined) return;
    fields.push({
      field,
      value,
      ...(before !== undefined ? { before } : {}),
      ...extra,
    });
  };
  const skillsText = (skills: string[] | undefined) =>
    skills === undefined ? undefined : skills.join(', ');
  switch (row.kind) {
    case 'create_project':
      add('name', text(payload.name));
      add('key', text(payload.key));
      add('description', text(payload.description));
      add('instructions', text(payload.instructions));
      break;
    case 'update_project':
      add('name', text(payload.name), text(base.name));
      add(
        'description',
        text(payload.description),
        text(base.description) ?? '',
      );
      add(
        'instructions',
        text(payload.instructions),
        text(base.instructions) ?? '',
      );
      {
        const chatAgent = chatAgentViewOf(payload.chatAgentView);
        const chatAgentBefore = chatAgentViewOf(base.chatAgentView);
        add(
          'defaultChatAgent',
          text(payload.chatAgentLabel),
          text(base.chatAgentLabel),
          {
            ...(chatAgent !== undefined ? { chatAgent } : {}),
            ...(chatAgentBefore !== undefined ? { chatAgentBefore } : {}),
          },
        );
      }
      break;
    case 'create_agent': {
      const skills = list(payload.skills) ?? [];
      add('name', text(payload.name));
      add('model', text(payload.modelLabel));
      add('runtime', text(payload.harnessLabel));
      // A new agent without skills shows no skills row.
      if (skills.length > 0) add('skills', skillsText(skills));
      add('instructions', text(payload.instructions));
      break;
    }
    case 'update_agent':
      add('name', text(payload.name), text(base.name));
      add('model', text(payload.modelLabel), text(base.modelLabel));
      add(
        'skills',
        skillsText(list(payload.skills)),
        skillsText(list(base.skills)),
      );
      add(
        'instructions',
        text(payload.instructions),
        text(base.instructions) ?? '',
      );
      break;
  }
  const projectId = row.projectId ?? text(result.projectId);
  const agentId = row.agentId ?? text(result.agentId);
  const code = text(result.code);
  // The names as they stand now; before a new project or agent exists, or
  // once it is gone, the names the proposal gave or found.
  const projectName =
    row.projectName ??
    (row.kind === 'create_project' ? text(payload.name) : undefined);
  const agentName =
    row.agentName ??
    (row.kind === 'create_agent' ? text(payload.name) : text(base.name));
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(projectName !== undefined ? { projectName } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(agentName !== undefined ? { agentName } : {}),
    fields,
    ...(row.status === 'failed' && code !== undefined
      ? { failure: { code, reason: proposalFailureOf(code) } }
      : {}),
    createdAt: row.createdAt,
    ...(row.decidedAt !== null ? { decidedAt: row.decidedAt } : {}),
  };
}

const PROPOSAL_COLUMNS = `
  p.id, p.kind, p.status, p.project_id AS "projectId",
  p.agent_id AS "agentId", p.payload, p.base, p.result,
  p.created_at_ms::float8 AS "createdAt",
  p.decided_at_ms::float8 AS "decidedAt",
  pr.name AS "projectName", pa.name AS "agentName"
`;

/** The proposals of a conversation, oldest first, as its cards show them.
 * The caller has checked that the reader may read the conversation. */
export async function listConversationProposals(
  sql: Sql,
  args: { organizationId: string; rootThreadId: string },
): Promise<ChatProposalView[]> {
  const rows = await sql<ProposalRow[]>`
    SELECT ${sql.unsafe(PROPOSAL_COLUMNS)}
    FROM app.chat_proposals p
    LEFT JOIN app.projects pr
      ON pr.id = coalesce(p.project_id, p.result ->> 'projectId')
     AND pr.org_id = p.org_id
    LEFT JOIN app.project_agents pa
      ON pa.id = coalesce(p.agent_id, p.result ->> 'agentId')
     AND pa.org_id = p.org_id
    WHERE p.org_id = ${args.organizationId}
      AND p.thread_id = ${args.rootThreadId}
    ORDER BY p.created_at_ms ASC, p.id ASC
  `;
  return rows.map(viewOf);
}

// --------------------------------------------------------------- deciding

export class ProposalError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(code: string, message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'ProposalError';
    this.code = code;
    this.status = status;
  }
}

interface OwnedProposal {
  id: string;
  threadId: string;
  kind: ProposalKind;
  status: ChatProposalView['status'];
  projectId: string | null;
  agentId: string | null;
  payload: unknown;
  base: unknown;
}

async function lockOwned(
  tx: TransactionSql,
  args: { organizationId: string; userId: string; proposalId: string },
): Promise<OwnedProposal> {
  const rows = await tx<OwnedProposal[]>`
    SELECT id, thread_id AS "threadId", kind, status,
           project_id AS "projectId", agent_id AS "agentId", payload, base
    FROM app.chat_proposals
    WHERE id = ${args.proposalId} AND org_id = ${args.organizationId}
      AND user_id = ${args.userId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new ProposalError(
      'PROPOSAL_NOT_FOUND',
      'The proposal was not found.',
      404,
    );
  }
  return row;
}

/** The kind of the person's proposal while it is pending; null otherwise. */
async function pendingKind(
  sql: Sql,
  args: { organizationId: string; userId: string; proposalId: string },
): Promise<ProposalKind | null> {
  const rows = await sql<{ kind: ProposalKind }[]>`
    SELECT kind FROM app.chat_proposals
    WHERE id = ${args.proposalId} AND org_id = ${args.organizationId}
      AND user_id = ${args.userId} AND status = 'pending'
  `;
  return rows[0]?.kind ?? null;
}

async function readOne(
  sql: Sql | TransactionSql,
  organizationId: string,
  proposalId: string,
): Promise<ChatProposalView> {
  const rows = await sql<ProposalRow[]>`
    SELECT ${sql.unsafe(PROPOSAL_COLUMNS)}
    FROM app.chat_proposals p
    LEFT JOIN app.projects pr
      ON pr.id = coalesce(p.project_id, p.result ->> 'projectId')
     AND pr.org_id = p.org_id
    LEFT JOIN app.project_agents pa
      ON pa.id = coalesce(p.agent_id, p.result ->> 'agentId')
     AND pa.org_id = p.org_id
    WHERE p.id = ${proposalId} AND p.org_id = ${organizationId}
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new ProposalError(
      'PROPOSAL_NOT_FOUND',
      'The proposal was not found.',
      404,
    );
  }
  return viewOf(row);
}

const STALE_MESSAGE =
  'This changed since the proposal was made. Ask the chat for a new one.';

/** What a card says of a refusal, by its code. */
export function proposalFailureOf(code: string): ProposalFailure {
  if (code.endsWith('_STALE')) return 'stale';
  if (code.endsWith('_NOT_FOUND')) return 'gone';
  if (code === 'PROJECT_ARCHIVED') return 'archived';
  if (code === 'PROJECT_KEY_TAKEN') return 'keyTaken';
  if (code === 'PROJECT_AGENT_NAME_TAKEN') return 'nameTaken';
  if (
    code === 'PROJECT_AGENT_MODEL_INVALID' ||
    code === 'PROJECT_AGENT_PROVIDER_UNKNOWN' ||
    code === 'PROJECT_AGENT_HARNESS_INVALID'
  ) {
    return 'model';
  }
  if (code === 'PROJECT_AGENT_SKILL_UNKNOWN') return 'skills';
  if (code === 'PROJECT_AGENT_LIMIT') return 'limit';
  if (code.endsWith('_FORBIDDEN') || code === 'TEAM_ACCESS_DENIED') {
    return 'forbidden';
  }
  return 'invalid';
}

/**
 * Apply a pending proposal, as the person whose chat made it: the change
 * it names, through the same services the pages use, inside one
 * transaction, at most once. A change the services refuse — a role taken
 * away, a name taken since, a project archived, an agent edited since —
 * leaves everything as it was and marks the proposal failed, with why.
 */
export async function applyProposal(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    role: string;
    email?: string;
    proposalId: string;
  },
): Promise<ChatProposalView> {
  try {
    const auth = await getProjectAuthContext(
      sql,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        role: args.role,
      },
      args.email,
    );
    if ((await pendingKind(sql, args)) === 'create_project') {
      // The charge the create-project page pays; over it, the proposal
      // stays pending and the person can try again later.
      await checkUserRateLimit(sql, 'project:create', auth.userId);
    }
    const result = await transactSerializable(sql, async (tx) => {
      const proposal = await lockOwned(tx, args);
      if (proposal.status !== 'pending') return null;
      const made = await runInRequestChannel(
        {
          via: 'chat',
          threadId: proposal.threadId,
          proposalId: proposal.id,
        },
        () => applyInTx(tx, auth, proposal),
      );
      await tx`
        UPDATE app.chat_proposals SET
          status = 'applied', result = ${tx.json(toJson(made))},
          decided_at_ms = ${Date.now()}
        WHERE id = ${proposal.id}
      `;
      return made;
    });
    if (result === null) {
      return readOne(sql, args.organizationId, args.proposalId);
    }
  } catch (error) {
    if (!(error instanceof ProjectError) && !(error instanceof ProposalError)) {
      throw error;
    }
    if (error instanceof ProposalError && error.code === 'PROPOSAL_NOT_FOUND') {
      throw error;
    }
    // The change did not happen; the proposal says why, for good.
    await sql`
      UPDATE app.chat_proposals SET
        status = 'failed',
        result = ${sql.json(toJson({ code: error.code, message: error.message }))},
        decided_at_ms = ${Date.now()}
      WHERE id = ${args.proposalId} AND org_id = ${args.organizationId}
        AND user_id = ${args.userId} AND status = 'pending'
    `;
  }
  return readOne(sql, args.organizationId, args.proposalId);
}

async function applyInTx(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  proposal: OwnedProposal,
): Promise<{ projectId: string; agentId?: string }> {
  const payload = record(proposal.payload);
  const base = record(proposal.base);
  switch (proposal.kind) {
    case 'create_project': {
      assertCanCreateProjects(auth);
      const key = text(payload.key);
      const description = text(payload.description);
      const projectId = await createProject(tx, auth, {
        name: text(payload.name) ?? '',
        ...(key !== undefined ? { key } : {}),
        ...(description !== undefined ? { description } : {}),
      });
      await ensureDefaultProjectLabels(tx, {
        organizationId: auth.organizationId,
        projectId,
        createdBy: auth.userId,
      });
      const instructions = text(payload.instructions);
      if (instructions !== undefined) {
        await updateProjectInstructions(tx, auth, projectId, instructions);
      }
      return { projectId };
    }
    case 'update_project': {
      const projectId = proposal.projectId;
      if (projectId === null) throw staleError();
      // The services check the person's rights again; this read is only
      // what the proposal compares against.
      const project = await loadProjectOrThrow(tx, projectId);
      // Each field the proposal changes must still read as it did then.
      if (
        (payload.name !== undefined && project.name !== text(base.name)) ||
        (payload.description !== undefined &&
          (project.description ?? null) !== (base.description ?? null)) ||
        (payload.instructions !== undefined &&
          (project.instructions ?? null) !== (base.instructions ?? null))
      ) {
        throw staleError();
      }
      const name = text(payload.name);
      const description = text(payload.description);
      if (name !== undefined || description !== undefined) {
        await updateProjectIdentity(tx, auth, {
          projectId,
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined
            ? { description: description === '' ? null : description }
            : {}),
        });
      }
      const instructions = text(payload.instructions);
      if (instructions !== undefined) {
        await updateProjectInstructions(tx, auth, projectId, instructions);
      }
      if (payload.chatAgent !== undefined) {
        const chatAgent = projectChatAgentSchema.safeParse(payload.chatAgent);
        const expected = projectChatAgentSchema.safeParse(base.chatAgent);
        if (!chatAgent.success || !expected.success) throw staleError();
        await setProjectChatAgent(tx, auth, projectId, {
          chatAgent: chatAgent.data,
          expected: expected.data,
        });
      }
      return { projectId };
    }
    case 'create_agent': {
      const projectId = proposal.projectId;
      if (projectId === null) throw staleError();
      const instructions = text(payload.instructions);
      const modelProvider = text(payload.modelProvider);
      const agentId = await createProjectAgent(tx, auth, {
        projectId,
        name: text(payload.name) ?? '',
        harness: text(payload.harness) ?? '',
        model: text(payload.model) ?? '',
        ...(modelProvider !== undefined ? { modelProvider } : {}),
        skills: list(payload.skills) ?? [],
        connectors: [],
        ...(instructions !== undefined ? { instructions } : {}),
      });
      return { projectId, agentId };
    }
    case 'update_agent': {
      const projectId = proposal.projectId;
      const agentId = proposal.agentId;
      if (projectId === null || agentId === null) throw staleError();
      const current = (
        await tx<
          {
            name: string;
            harness: string;
            model: string;
            modelProvider: string | null;
            skills: string[];
            connectors: string[];
            tools: string[];
            secrets: string[];
            instructions: string | null;
          }[]
        >`
          SELECT name, harness, model, model_provider AS "modelProvider",
                 skills, connectors, tools, secrets, instructions
          FROM app.project_agents
          WHERE id = ${agentId} AND project_id = ${projectId}
            AND org_id = ${auth.organizationId}
        `
      )[0];
      if (current === undefined) throw staleError();
      const instructions =
        text(payload.instructions) ?? current.instructions ?? undefined;
      const modelProvider =
        text(payload.modelProvider) ?? current.modelProvider ?? undefined;
      await updateProjectAgent(tx, auth, {
        agentId,
        name: text(payload.name) ?? current.name,
        harness: current.harness,
        model: text(payload.model) ?? current.model,
        ...(modelProvider !== undefined ? { modelProvider } : {}),
        skills: list(payload.skills) ?? current.skills,
        connectors: current.connectors,
        tools: current.tools,
        secrets: current.secrets,
        ...(instructions !== undefined ? { instructions } : {}),
        // Refused as stale when the agent changed since the proposal read it.
        ...(typeof base.updatedAt === 'number'
          ? { expectedUpdatedAt: base.updatedAt }
          : {}),
      });
      return { projectId, agentId };
    }
  }
  const unknownKind: never = proposal.kind;
  throw new Error(`proposal kind ${String(unknownKind)} has no apply`);
}

function staleError(): ProposalError {
  return new ProposalError('PROPOSAL_STALE', STALE_MESSAGE, 409);
}

/** Dismiss a pending proposal: nothing changes, and the card says so. */
export async function dismissProposal(
  sql: Sql,
  args: { organizationId: string; userId: string; proposalId: string },
): Promise<ChatProposalView> {
  await transactSerializable(sql, async (tx) => {
    const proposal = await lockOwned(tx, args);
    if (proposal.status !== 'pending') return;
    await tx`
      UPDATE app.chat_proposals SET
        status = 'dismissed', decided_at_ms = ${Date.now()}
      WHERE id = ${proposal.id}
    `;
  });
  return readOne(sql, args.organizationId, args.proposalId);
}

/** The conversation a proposal belongs to, for a reader's access check. */
export async function proposalThreadId(
  sql: Sql,
  args: { organizationId: string; proposalId: string },
): Promise<string | null> {
  const rows = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.chat_proposals
    WHERE id = ${args.proposalId} AND org_id = ${args.organizationId}
  `;
  return rows[0]?.threadId ?? null;
}
