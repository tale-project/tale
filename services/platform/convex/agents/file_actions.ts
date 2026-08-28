'use node';

/**
 * Internal `'use node'` handlers for reading and editing an organization's
 * agents. The public `actions.ts` authenticates the caller, resolves the org
 * slug from a verified membership, and delegates here — a separate module so
 * the generated api types keep their shapes instead of collapsing to `any`,
 * which is also why every handler carries an explicit return annotation.
 *
 * The visibility rule is applied HERE, at the filesystem edge: an agent the
 * asking member may not use never leaves this layer, so no caller can leak one
 * by forgetting to filter — including the turn resolver, which reads through
 * the same gate as the roster. The org slug arrives already verified; every
 * path is then resolved from it alone, which is what keeps one org's agents
 * out of another's.
 */

import { ConvexError, v } from 'convex/values';

import {
  canEditAgent,
  canViewAgent,
  listOrgAgents,
  readOrgAgent,
  type AgentViewer,
  type OrgAgent,
} from '../../lib/agents/listing';
import {
  AgentParseError,
  parseAgentYaml,
  serializeAgentYaml,
} from '../../lib/agents/parse';
import { resolveAgentForTurn } from '../../lib/agents/resolve';
import {
  isValidAgentSlug,
  type AgentDefinition,
} from '../../lib/shared/schemas/agents';
import { internalAction } from '../_generated/server';
import {
  createOrgAgentReader,
  listAgentHistoryEntries,
  readAgentHistoryText,
  relativeAgentPath,
  removeAgentFile,
  resolveAgentFilePath,
  writeAgentFileText,
  type AgentHistoryEntry,
} from './file_utils';
import {
  agentDocumentValidator,
  agentEditArgs,
  agentListingValidator,
  agentViewerArgs,
  resolvedAgentValidator,
  type AgentDocumentView,
  type AgentListingView,
  type AgentSummaryView,
  type ResolvedAgentView,
} from './validators';

/**
 * Agents only know `private | org`, so the member's teams never influence
 * agent visibility — the viewer carries an empty team list by construction.
 */
function viewerFrom(args: {
  viewerUserId: string;
  isOrgAdmin: boolean;
}): AgentViewer & { kind: 'user' } {
  return {
    kind: 'user',
    userId: args.viewerUserId,
    teamIds: [],
    isOrgAdmin: args.isOrgAdmin,
  };
}

function toSummary(agent: OrgAgent, viewer: AgentViewer): AgentSummaryView {
  const { definition } = agent;
  return {
    slug: agent.slug,
    displayName: definition.displayName,
    description: definition.description,
    visibility: definition.visibility,
    owner: definition.owner,
    icon: definition.icon,
    labels: definition.labels,
    knowledge: definition.knowledge,
    canEdit: canEditAgent(definition, viewer),
  };
}

function toDocument(agent: OrgAgent, viewer: AgentViewer): AgentDocumentView {
  const { definition } = agent;
  return {
    ...toSummary(agent, viewer),
    instructions: definition.instructions,
    tools: definition.tools,
    skills: definition.skills,
    i18n: definition.i18n,
  };
}

function assertValidSlug(slug: string): void {
  if (!isValidAgentSlug(slug)) {
    throw new ConvexError({
      code: 'INVALID_AGENT_SLUG',
      message: `"${slug}" is not a valid agent slug — use lowercase letters, digits and single hyphens or underscores.`,
    });
  }
}

/** How a caller is identified to the file layer (see `agentViewerArgs`). */
export interface AgentCallerArgs {
  orgSlug: string;
  viewerUserId: string;
  isOrgAdmin: boolean;
}

/**
 * The agents the asking member can use in this org, plus any file that failed
 * to load. Failures are logged with their absolute path (the operator signal)
 * and returned with the org-relative one.
 *
 * Each operation here is a PLAIN exported function with the Convex
 * `internalAction` as a thin wrapper — the 0.5 backend reuses the functions
 * directly (same pattern as `chat/turn_action.executeTurn`).
 */
export async function listAgentsForCaller(
  args: AgentCallerArgs,
): Promise<AgentListingView> {
  const viewer = viewerFrom(args);
  const listing = await listOrgAgents(
    createOrgAgentReader(args.orgSlug),
    viewer,
  );
  for (const failure of listing.failures) {
    console.error(
      `[agents] ${args.orgSlug}: skipping unreadable agent — ${failure.message}`,
    );
  }
  return {
    agents: listing.agents.map((agent) => toSummary(agent, viewer)),
    failures: listing.failures.map((failure) => ({
      slug: failure.slug,
      path: relativeAgentPath(failure.slug),
      message: failure.message,
    })),
  };
}

export const listAgents = internalAction({
  args: { orgSlug: v.string(), ...agentViewerArgs },
  returns: agentListingValidator,
  handler: async (_ctx, args): Promise<AgentListingView> =>
    listAgentsForCaller(args),
});

/**
 * One agent in full, or `null` when the org has no such file. An agent the
 * member may not use reads as absent — telling them it exists would already
 * leak someone else's private persona.
 */
export async function readAgentForCaller(
  args: AgentCallerArgs & { slug: string },
): Promise<AgentDocumentView | null> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  const agent = await loadAgentOrThrow(args.orgSlug, args.slug);
  if (agent === null || !canViewAgent(agent.definition, viewer)) return null;
  return toDocument(agent, viewer);
}

export const readAgent = internalAction({
  args: { orgSlug: v.string(), slug: v.string(), ...agentViewerArgs },
  returns: v.union(v.null(), agentDocumentValidator),
  handler: async (_ctx, args): Promise<AgentDocumentView | null> =>
    readAgentForCaller(args),
});

/**
 * The agent answering one turn, resolved for `locale`: its localized words
 * plus what it may reach for. `null` when the org has no such agent or the
 * member may not use it — a turn cannot borrow a persona its author kept
 * private.
 */
export async function resolveAgentForCaller(
  args: AgentCallerArgs & { slug: string; locale: string },
): Promise<ResolvedAgentView | null> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  const agent = await loadAgentOrThrow(args.orgSlug, args.slug);
  if (agent === null || !canViewAgent(agent.definition, viewer)) return null;

  const resolved = resolveAgentForTurn(agent.definition, args.locale);
  return {
    slug: resolved.slug,
    displayName: resolved.displayName,
    description: resolved.description,
    instructions: resolved.instructions,
    tools: resolved.tools === undefined ? undefined : [...resolved.tools],
    skills: resolved.skills === undefined ? undefined : [...resolved.skills],
    knowledge: resolved.knowledge,
  };
}

export const resolveAgent = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    locale: v.string(),
    ...agentViewerArgs,
  },
  returns: v.union(v.null(), resolvedAgentValidator),
  handler: async (_ctx, args): Promise<ResolvedAgentView | null> =>
    resolveAgentForCaller(args),
});

/**
 * Create or update an agent.
 *
 * A new agent belongs to its author and is `private` unless the caller says
 * otherwise. An edit preserves the owner and every field the edit surface does
 * not carry — the localized overrides, the free-form metadata — so saving from
 * a form does not quietly strip an agent's translations. Turning a shared
 * agent back into a private one with no recorded owner adopts the editor,
 * because a private agent without an owner is reachable by nobody.
 *
 * An omitted optional field means "leave it as it is", so an edit that only
 * changes the instructions cannot blank the icon or widen a binding list.
 */
/** The edit surface (see `agentEditArgs` for the field semantics). */
export interface AgentEditInput {
  displayName: string;
  description?: string;
  instructions?: string;
  visibility?: AgentDefinition['visibility'];
  icon?: string;
  labels?: string[];
  tools?: string[] | null;
  skills?: string[] | null;
  knowledge?: AgentDefinition['knowledge'];
}

export async function saveAgentForCaller(
  args: AgentCallerArgs & { slug: string } & AgentEditInput,
): Promise<AgentDocumentView> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  const existing = await loadAgentOrThrow(args.orgSlug, args.slug);

  if (existing !== null && !canEditAgent(existing.definition, viewer)) {
    throw new ConvexError({
      code: 'AGENT_FORBIDDEN',
      message: `You cannot edit the agent "${args.slug}".`,
    });
  }

  const visibility =
    args.visibility ?? existing?.definition.visibility ?? 'private';
  const owner =
    existing === null
      ? viewer.userId
      : (existing.definition.owner ??
        (visibility === 'private' ? viewer.userId : undefined));

  const definition: AgentDefinition = {
    // Start from what is on disk so an edit form cannot silently drop the
    // fields it does not show — the translations, the metadata.
    ...existing?.definition,
    name: args.slug,
    displayName: args.displayName,
    description: args.description ?? existing?.definition.description,
    visibility,
    owner,
    icon: args.icon ?? existing?.definition.icon,
    labels: args.labels ?? existing?.definition.labels,
    instructions: args.instructions ?? existing?.definition.instructions,
    // `null` clears a narrowing (list absent again = "not narrowed");
    // absent keeps whatever the file says.
    tools:
      args.tools === null
        ? undefined
        : (args.tools ?? existing?.definition.tools),
    skills:
      args.skills === null
        ? undefined
        : (args.skills ?? existing?.definition.skills),
    knowledge: args.knowledge ?? existing?.definition.knowledge ?? 'all',
  };

  const content = serializeAgentYaml(definition);
  // Re-read what we are about to persist: a save must never be able to
  // write a file the readers would then reject.
  let verified: AgentDefinition;
  try {
    verified = parseAgentYaml(
      content,
      resolveAgentFilePath(args.orgSlug, args.slug),
    );
  } catch (err) {
    if (err instanceof AgentParseError) {
      throw new ConvexError({
        code: 'INVALID_AGENT',
        message: `The agent could not be saved: ${err.detail}`,
      });
    }
    throw err;
  }
  await writeAgentFileText(args.orgSlug, args.slug, content);

  return toDocument(
    {
      slug: args.slug,
      path: relativeAgentPath(args.slug),
      definition: verified,
    },
    viewer,
  );
}

export const saveAgent = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    ...agentViewerArgs,
    ...agentEditArgs,
  },
  returns: agentDocumentValidator,
  handler: async (_ctx, args): Promise<AgentDocumentView> =>
    saveAgentForCaller(args),
});

/**
 * The superseded versions of one agent, newest first. Every save leaves the
 * previous file in the trail, so this is the whole restore surface. Visible
 * to whoever may view the agent; restoring is an edit and gated as one.
 */
export async function listHistoryForCaller(
  args: AgentCallerArgs & { slug: string },
): Promise<AgentHistoryEntry[]> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  const existing = await loadAgentOrThrow(args.orgSlug, args.slug);
  if (existing === null || !canViewAgent(existing.definition, viewer)) {
    return [];
  }
  return listAgentHistoryEntries(args.orgSlug, args.slug);
}

export const listHistory = internalAction({
  args: { orgSlug: v.string(), slug: v.string(), ...agentViewerArgs },
  returns: v.array(v.object({ entry: v.string(), savedAt: v.number() })),
  handler: async (_ctx, args): Promise<AgentHistoryEntry[]> =>
    listHistoryForCaller(args),
});

/**
 * Restore one history snapshot as the agent's current version. Additive on
 * purpose: the write snapshots the superseded current file into the trail
 * first, so a restore never destroys the state it replaced. The snapshot is
 * re-parsed before it lands — a trail entry the readers would reject (an
 * older shape, a hand-edited file) refuses with the parse detail instead of
 * bricking the agent.
 */
export async function restoreFromHistoryForCaller(
  args: AgentCallerArgs & { slug: string; entry: string },
): Promise<AgentDocumentView> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  const existing = await loadAgentOrThrow(args.orgSlug, args.slug);
  if (existing === null || !canEditAgent(existing.definition, viewer)) {
    throw new ConvexError({
      code: 'AGENT_FORBIDDEN',
      message: `You cannot restore the agent "${args.slug}".`,
    });
  }

  const content = await readAgentHistoryText(
    args.orgSlug,
    args.slug,
    args.entry,
  );
  if (content === null) {
    throw new ConvexError({
      code: 'AGENT_HISTORY_ENTRY_NOT_FOUND',
      message: `History entry "${args.entry}" no longer exists for "${args.slug}".`,
    });
  }

  let restored: AgentDefinition;
  try {
    restored = parseAgentYaml(
      content,
      resolveAgentFilePath(args.orgSlug, args.slug),
    );
  } catch (err) {
    if (err instanceof AgentParseError) {
      throw new ConvexError({
        code: 'INVALID_AGENT',
        message: `The snapshot could not be restored: ${err.detail}`,
      });
    }
    throw err;
  }

  await writeAgentFileText(args.orgSlug, args.slug, content);
  return toDocument(
    {
      slug: args.slug,
      path: relativeAgentPath(args.slug),
      definition: restored,
    },
    viewer,
  );
}

export const restoreFromHistory = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    entry: v.string(),
    ...agentViewerArgs,
  },
  returns: agentDocumentValidator,
  handler: async (_ctx, args): Promise<AgentDocumentView> =>
    restoreFromHistoryForCaller(args),
});

/** Delete an agent and its history. Deleting an absent one is a no-op. */
export async function deleteAgentForCaller(
  args: AgentCallerArgs & { slug: string },
): Promise<boolean> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  const existing = await loadAgentOrThrow(args.orgSlug, args.slug);
  if (existing === null) return false;
  if (!canEditAgent(existing.definition, viewer)) {
    throw new ConvexError({
      code: 'AGENT_FORBIDDEN',
      message: `You cannot delete the agent "${args.slug}".`,
    });
  }
  return removeAgentFile(args.orgSlug, args.slug);
}

export const deleteAgent = internalAction({
  args: { orgSlug: v.string(), slug: v.string(), ...agentViewerArgs },
  returns: v.boolean(),
  handler: async (_ctx, args): Promise<boolean> => deleteAgentForCaller(args),
});

/**
 * Read one agent, turning a malformed file into a ConvexError that names the
 * org-relative path. The caller sees which file to fix rather than an agent
 * that silently is not there.
 */
async function loadAgentOrThrow(
  orgSlug: string,
  slug: string,
): Promise<OrgAgent | null> {
  try {
    return await readOrgAgent(createOrgAgentReader(orgSlug), slug);
  } catch (err) {
    if (err instanceof AgentParseError) {
      console.error(`[agents] ${orgSlug}: ${err.message}`);
      // The client gets the org-relative path; the absolute one stays in the
      // server log where the operator reads it.
      throw new ConvexError({
        code: 'AGENT_MALFORMED',
        message: `${relativeAgentPath(slug)} could not be read: ${err.detail}`,
      });
    }
    throw err;
  }
}
