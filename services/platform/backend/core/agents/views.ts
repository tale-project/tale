/**
 * Wire shapes shared by the `agents` domain's routes and the file actions
 * behind them.
 *
 * Kept in its own module (no filesystem) so both layers import the same
 * shapes without either pulling the other's runtime in. Nothing here
 * describes an execution: an agent crosses the wire as a persona — words,
 * bindings, and who may use it — which is all it ever is.
 */

import type {
  AgentKnowledgeScope,
  AgentVisibility,
} from '../../../lib/shared/schemas/agents';

/** The fields every agent view carries. */
export interface AgentSummaryView {
  slug: string;
  displayName: string;
  description?: string;
  /**
   * `private | org`. The agent schema's `AGENT_VISIBILITIES` stays the source
   * of truth for the set.
   */
  visibility: AgentVisibility;
  owner?: string;
  icon?: string;
  labels?: string[];
  /** Which knowledge an agent's retrieval may read. */
  knowledge: AgentKnowledgeScope;
  /** Whether the asking member may change this agent. */
  canEdit: boolean;
}

/**
 * One agent in full: its authored instructions and its binding lists. An
 * ABSENT list means the agent is not narrowed; an empty one means nothing is
 * allowed — the distinction survives the wire because both are optional
 * arrays, never a defaulted one.
 */
export interface AgentDocumentView extends AgentSummaryView {
  instructions?: string;
  tools?: string[];
  skills?: string[];
  i18n?: Record<
    string,
    { displayName?: string; description?: string; instructions?: string }
  >;
}

/**
 * An agent as one turn sees it: localized words plus what it may reach for.
 * Deliberately carries no model, no ceiling and no harness — those belong to
 * wherever the turn runs.
 */
export interface ResolvedAgentView {
  slug: string;
  displayName: string;
  description?: string;
  instructions?: string;
  tools?: string[];
  skills?: string[];
  knowledge: AgentKnowledgeScope;
}

/**
 * An agent file that failed to load. `path` is relative to the org's config
 * tree so an operator can find the file without the server's absolute layout
 * being handed to a browser.
 */
export interface AgentLoadFailureView {
  slug: string;
  path: string;
  message: string;
}

export interface AgentListingView {
  agents: AgentSummaryView[];
  failures: AgentLoadFailureView[];
}
