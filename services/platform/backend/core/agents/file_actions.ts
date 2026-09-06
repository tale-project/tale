'use node';

import {
  canEditAgent,
  canViewAgent,
  listOrgAgents,
  readOrgAgent,
  type AgentViewer,
  type OrgAgent,
} from '../../../lib/agents/listing';
import {
  AgentParseError,
  parseAgentYaml,
  serializeAgentYaml,
} from '../../../lib/agents/parse';
import { AppError } from '../../../lib/shared/errors/app-error';
import {
  isValidAgentSlug,
  type AgentDefinition,
} from '../../../lib/shared/schemas/agents';
import {
  createOrgAgentReader,
  relativeAgentPath,
  removeAgentFile,
  resolveAgentFilePath,
  writeAgentFileText,
} from './file_utils';
import {
  type AgentDocumentView,
  type AgentListingView,
  type AgentSummaryView,
} from './views';

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
    throw new AppError({
      code: 'INVALID_AGENT_SLUG',
      message: `"${slug}" is not a valid agent slug — use lowercase letters, digits and single hyphens or underscores.`,
    });
  }
}

/** How a caller is identified to the file layer. */
export interface AgentCallerArgs {
  orgSlug: string;
  viewerUserId: string;
  /** True when the member may administer the org's shared configuration. */
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
/** The edit surface. Everything else in the file round-trips. */
export interface AgentEditInput {
  displayName: string;
  description?: string;
  instructions?: string;
  /**
   * Absent keeps an existing agent's current visibility and makes a new one
   * `private` — an agent starts as its author's own, and sharing it is an
   * explicit edit to `org`.
   */
  visibility?: AgentDefinition['visibility'];
  icon?: string;
  labels?: string[];
  /**
   * Absent leaves the allowlist as it is; an empty array narrows to nothing;
   * `null` REMOVES the narrowing (back to "everything the org offers") —
   * without it a widening would be inexpressible, since absent means keep.
   */
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
    throw new AppError({
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
      throw new AppError({
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
/**
 * Delete an agent and its history. Deleting an absent one is a no-op.
 *
 * Deleting is the one operation that needs no readable definition. A file
 * that fails to parse — the library lists it as a failure — has no owner or
 * visibility left to consult, so removing it falls to an org admin; agents
 * have no upload lane, so this is the only in-product repair there is.
 */
export async function deleteAgentForCaller(
  args: AgentCallerArgs & { slug: string },
): Promise<boolean> {
  assertValidSlug(args.slug);
  const viewer = viewerFrom(args);
  let existing: OrgAgent | null;
  try {
    existing = await readOrgAgent(
      createOrgAgentReader(args.orgSlug),
      args.slug,
    );
  } catch (err) {
    if (!(err instanceof AgentParseError)) throw err;
    console.error(`[agents] ${args.orgSlug}: ${err.message}`);
    if (!viewer.isOrgAdmin) {
      throw new AppError({
        code: 'AGENT_FORBIDDEN',
        message: `Only an organization admin can delete the unreadable agent "${args.slug}".`,
      });
    }
    return removeAgentFile(args.orgSlug, args.slug);
  }
  if (existing === null) return false;
  if (!canEditAgent(existing.definition, viewer)) {
    throw new AppError({
      code: 'AGENT_FORBIDDEN',
      message: `You cannot delete the agent "${args.slug}".`,
    });
  }
  return removeAgentFile(args.orgSlug, args.slug);
}
/**
 * Read one agent, turning a malformed file into a AppError that names the
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
      throw new AppError({
        code: 'AGENT_MALFORMED',
        message: `${relativeAgentPath(slug)} could not be read: ${err.detail}`,
      });
    }
    throw err;
  }
}
