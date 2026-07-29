/**
 * Wire shapes shared by the `agents` domain's public actions and the
 * `'use node'` file actions behind them.
 *
 * Kept in its own module (no `'use node'`, no filesystem) so both layers
 * import the same validators without either pulling the other's runtime in.
 * Nothing here describes an execution: an agent crosses the wire as a
 * persona — words, bindings, and who may use it — which is all it ever is.
 */

import { v } from 'convex/values';

import type {
  AgentKnowledgeScope,
  AgentVisibility,
} from '../../lib/shared/schemas/agents';

/**
 * `private | org` at the wire boundary. The agent schema's
 * `AGENT_VISIBILITIES` stays the source of truth for the set; the type
 * parameters here fail the build if a literal ever stops belonging to it.
 */
export const agentVisibilityValidator = v.union(
  v.literal<AgentVisibility>('private'),
  v.literal<AgentVisibility>('org'),
);

/** Which knowledge an agent's retrieval may read. */
export const agentKnowledgeScopeValidator = v.union(
  v.literal<AgentKnowledgeScope>('none'),
  v.literal<AgentKnowledgeScope>('documents'),
  v.literal<AgentKnowledgeScope>('web'),
  v.literal<AgentKnowledgeScope>('all'),
);

/** The fields every agent view carries. */
const agentSummaryFields = {
  slug: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  visibility: agentVisibilityValidator,
  owner: v.optional(v.string()),
  icon: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
  knowledge: agentKnowledgeScopeValidator,
  /** Whether the asking member may change this agent. */
  canEdit: v.boolean(),
};

export const agentSummaryValidator = v.object(agentSummaryFields);

/**
 * One agent in full: its authored instructions and its binding lists. An
 * ABSENT list means the agent is not narrowed; an empty one means nothing is
 * allowed — the distinction survives the wire because both are optional
 * arrays, never a defaulted one.
 */
export const agentDocumentValidator = v.object({
  ...agentSummaryFields,
  instructions: v.optional(v.string()),
  tools: v.optional(v.array(v.string())),
  skills: v.optional(v.array(v.string())),
  i18n: v.optional(
    v.record(
      v.string(),
      v.object({
        displayName: v.optional(v.string()),
        description: v.optional(v.string()),
        instructions: v.optional(v.string()),
      }),
    ),
  ),
});

/**
 * An agent as one turn sees it: localized words plus what it may reach for.
 * Deliberately carries no model, no ceiling and no harness — those belong to
 * wherever the turn runs.
 */
export const resolvedAgentValidator = v.object({
  slug: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  instructions: v.optional(v.string()),
  tools: v.optional(v.array(v.string())),
  skills: v.optional(v.array(v.string())),
  knowledge: agentKnowledgeScopeValidator,
});

/**
 * An agent file that failed to load. `path` is relative to the org's config
 * tree so an operator can find the file without the server's absolute layout
 * being handed to a browser.
 */
export const agentLoadFailureValidator = v.object({
  slug: v.string(),
  path: v.string(),
  message: v.string(),
});

export const agentListingValidator = v.object({
  agents: v.array(agentSummaryValidator),
  failures: v.array(agentLoadFailureValidator),
});

/** Editable fields of an agent. Everything else in the file round-trips. */
export const agentEditArgs = {
  displayName: v.string(),
  description: v.optional(v.string()),
  instructions: v.optional(v.string()),
  /**
   * Absent keeps an existing agent's current visibility and makes a new one
   * `private` — an agent starts as its author's own, and sharing it is an
   * explicit edit to `org`.
   */
  visibility: v.optional(agentVisibilityValidator),
  icon: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
  /**
   * Absent leaves the allowlist as it is; an empty array narrows to nothing;
   * `null` REMOVES the narrowing (back to "everything the org offers") —
   * without it a widening would be inexpressible, since absent means keep.
   */
  tools: v.optional(v.union(v.array(v.string()), v.null())),
  skills: v.optional(v.union(v.array(v.string()), v.null())),
  knowledge: v.optional(agentKnowledgeScopeValidator),
};

/** How the caller is identified to the file layer behind a public action. */
export const agentViewerArgs = {
  viewerUserId: v.string(),
  /** True when the member may administer the org's shared configuration. */
  isOrgAdmin: v.boolean(),
};

export interface AgentSummaryView {
  slug: string;
  displayName: string;
  description?: string;
  visibility: AgentVisibility;
  owner?: string;
  icon?: string;
  labels?: string[];
  knowledge: AgentKnowledgeScope;
  canEdit: boolean;
}

export interface AgentDocumentView extends AgentSummaryView {
  instructions?: string;
  tools?: string[];
  skills?: string[];
  i18n?: Record<
    string,
    { displayName?: string; description?: string; instructions?: string }
  >;
}

export interface ResolvedAgentView {
  slug: string;
  displayName: string;
  description?: string;
  instructions?: string;
  tools?: string[];
  skills?: string[];
  knowledge: AgentKnowledgeScope;
}

export interface AgentLoadFailureView {
  slug: string;
  path: string;
  message: string;
}

export interface AgentListingView {
  agents: AgentSummaryView[];
  failures: AgentLoadFailureView[];
}
