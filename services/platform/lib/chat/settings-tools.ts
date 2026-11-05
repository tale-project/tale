/**
 * The chat's tools for the workspace's projects and agents: a read, and a
 * proposal the person applies.
 *
 * A person can ask a chat to create a project, to change one, to add an
 * agent to a project or to change an agent. The model never writes any of
 * it: `propose_project_settings` checks the change as the person and keeps
 * it as a proposal, which the reply shows as a card — the person applies it
 * there, or dismisses it (`backend/domains/chat/proposals.ts`). Text from a
 * web page or a document can therefore make the model propose something,
 * but never change anything; and what a proposal can touch is narrow:
 * names, descriptions, instructions, models, skills and the default chat
 * agent — never sharing, secrets, connectors, tool grants or deletion.
 *
 * Offered only to a person who may create projects or change one, chatting
 * in the app: the tools act for them and can propose nothing they could not
 * do on the pages themselves. In a chat filed in a project they reach that
 * project alone, as its retrieval does, besides proposing a new project.
 *
 * Layer A: pure data.
 */

import {
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_NAME_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_NAME_MAX,
} from '@tale/shared/schemas/projects';

import type { ToolDoc } from './context';
import type { WireTool } from './tools';

export const READ_PROJECT_SETTINGS = 'read_project_settings';
export const PROPOSE_PROJECT_SETTINGS = 'propose_project_settings';

export const SETTINGS_TOOL_NAMES = [
  READ_PROJECT_SETTINGS,
  PROPOSE_PROJECT_SETTINGS,
] as const;
export type SettingsToolName = (typeof SETTINGS_TOOL_NAMES)[number];

export function isSettingsToolName(name: string): name is SettingsToolName {
  return (SETTINGS_TOOL_NAMES as readonly string[]).includes(name);
}

/** The changes a proposal can be. */
export const PROPOSAL_KINDS = [
  'create_project',
  'update_project',
  'create_agent',
  'update_agent',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const READ_SCHEMA = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description:
        'A project, by its name, key or id. Omit it to list the projects ' +
        'the person can open.',
    },
    agent: {
      type: 'string',
      description:
        "One of the project's agents, by its name or id: its full " +
        'settings, instructions included. Needs "project".',
    },
  },
  additionalProperties: false,
};

const PROPOSE_SCHEMA = {
  type: 'object',
  properties: {
    change: {
      type: 'string',
      enum: [...PROPOSAL_KINDS],
      description:
        'What to propose: create_project, update_project (its name, ' +
        'description, instructions or default chat agent), create_agent ' +
        '(an agent of a project), update_agent (its name, instructions, ' +
        'model or skills).',
    },
    project: {
      type: 'string',
      description:
        'The project the change is about or adds an agent to, by name, ' +
        'key or id — every change but create_project.',
    },
    agent: {
      type: 'string',
      description: 'The agent to change, by name or id — update_agent only.',
    },
    name: {
      type: 'string',
      description:
        'The name of the new project or agent, or its new name. At most ' +
        `${PROJECT_NAME_MAX} characters for a project, ${PROJECT_AGENT_NAME_MAX} for an agent.`,
    },
    key: {
      type: 'string',
      description:
        "create_project only: the prefix of the project's task ids, 2 to " +
        '6 letters or digits (WR for WR-12). It cannot change later; omit ' +
        'it to derive one from the name.',
    },
    description: {
      type: 'string',
      description: `A project description, at most ${PROJECT_DESCRIPTION_MAX} characters.`,
    },
    instructions: {
      type: 'string',
      description:
        "The complete instructions — the project's standing instructions " +
        `or the agent's — replacing the current ones; at most ${Math.min(PROJECT_INSTRUCTIONS_MAX_CHARS, PROJECT_AGENT_INSTRUCTIONS_MAX)} ` +
        'characters. To change part of them, read them first and send the ' +
        'whole new text.',
    },
    model: {
      type: 'string',
      description:
        "An agent's model, by its name or id as the person's model list " +
        'shows it (create_agent, update_agent).',
    },
    runtime: {
      type: 'string',
      description:
        "create_agent only: the agent runtime that runs the agent's tasks " +
        '(such as Claude Code or Codex). Omit it to take one that runs the ' +
        'model.',
    },
    skills: {
      type: 'array',
      items: { type: 'string' },
      maxItems: PROJECT_AGENT_BINDINGS_MAX,
      description:
        "The agent's skills, by name — the complete list, replacing the " +
        'current one (create_agent, update_agent). A new agent without ' +
        '"skills" gets the document skills (docx, pptx, xlsx, pdf) the ' +
        'project can equip.',
    },
    defaultChatAgent: {
      type: 'string',
      description:
        "update_project only: who the project's new chats start with — " +
        '"first" (the first agent created), "assistant", or one of its ' +
        'agents by name or id.',
    },
  },
  required: ['change'],
  additionalProperties: false,
};

const DESCRIPTIONS: Record<SettingsToolName, string> = {
  [READ_PROJECT_SETTINGS]:
    'Read the projects the person can open and their settings: without ' +
    'arguments, the projects (name, key, whether the person can change ' +
    'them); with "project", its description, instructions, default chat ' +
    'agent and agents; with "project" and "agent", that agent in full. ' +
    'Read before proposing a change to something that exists. In a chat ' +
    'filed in a project, only that project.',
  [PROPOSE_PROJECT_SETTINGS]:
    'Propose a change to a project or an agent: create a project; change ' +
    "a project's name, description, instructions or default chat agent; " +
    "add an agent to a project; change an agent's name, instructions, " +
    'model or skills. Use it only when the person asks for such a change. ' +
    'Nothing changes yet: the person sees the change as a card under your ' +
    'reply and applies or dismisses it there, so never say it is done. ' +
    "Sharing, secrets, connectors, an agent's tools and deleting anything " +
    "are made on the project's pages, not here — say so when asked. In a " +
    'chat filed in a project, only that project can change, besides a new ' +
    'project. One change per call.',
};

export const SETTINGS_WIRE_TOOLS: readonly WireTool[] = [
  {
    name: READ_PROJECT_SETTINGS,
    description: DESCRIPTIONS[READ_PROJECT_SETTINGS],
    parameters: READ_SCHEMA,
  },
  {
    name: PROPOSE_PROJECT_SETTINGS,
    description: DESCRIPTIONS[PROPOSE_PROJECT_SETTINGS],
    parameters: PROPOSE_SCHEMA,
  },
];

export const SETTINGS_TOOL_DOCS: readonly ToolDoc[] = [
  {
    id: READ_PROJECT_SETTINGS,
    description: "read the person's projects, their settings and agents",
  },
  {
    id: PROPOSE_PROJECT_SETTINGS,
    description:
      'propose a project or agent change for the person to apply in a card',
  },
];

/** Who a project's new chats answer as, as a card names it: the first agent
 * created (named when there is one), the assistant, or an agent. */
export type ProposalChatAgent =
  | { readonly kind: 'first'; readonly name?: string }
  | { readonly kind: 'assistant' }
  | { readonly kind: 'agent'; readonly name: string };

/** What a card shows of a field: the value a proposal sets, and the one it
 * replaces (absent on a new project or agent). `value` and `before` are
 * the model's words; a default chat agent also carries what the card puts
 * in the person's language. */
export interface ProposalField {
  readonly field:
    | 'name'
    | 'key'
    | 'description'
    | 'instructions'
    | 'model'
    | 'runtime'
    | 'skills'
    | 'defaultChatAgent';
  readonly value: string;
  readonly before?: string;
  readonly chatAgent?: ProposalChatAgent;
  readonly chatAgentBefore?: ProposalChatAgent;
}

/** Why an apply did not happen, as a card says it: the refusal folded into
 * what the person can do about it. */
export const PROPOSAL_FAILURES = [
  /** What it changes changed since it was proposed. */
  'stale',
  /** The project or the agent no longer exists. */
  'gone',
  /** The person may no longer make the change. */
  'forbidden',
  'archived',
  'nameTaken',
  'keyTaken',
  /** The model or the runtime can no longer run the agent. */
  'model',
  /** A skill can no longer be equipped. */
  'skills',
  /** The project has as many agents as it may. */
  'limit',
  'invalid',
] as const;
export type ProposalFailure = (typeof PROPOSAL_FAILURES)[number];

/** A proposal as the chat reads it back: what it changes, field by field,
 * and where it stands. */
export interface ChatProposalView {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly status: 'pending' | 'applied' | 'dismissed' | 'failed';
  /** The project it is about (absent while a new project does not exist). */
  readonly projectId?: string;
  readonly projectName?: string;
  /** The agent it changes, or the one it created. */
  readonly agentId?: string;
  readonly agentName?: string;
  readonly fields: readonly ProposalField[];
  /** Why an apply failed: the refusal's code, and what the card says. */
  readonly failure?: {
    readonly code: string;
    readonly reason: ProposalFailure;
  };
  readonly createdAt: number;
  readonly decidedAt?: number;
}
