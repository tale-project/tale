/**
 * Listing and reading the agents of ONE organization.
 *
 * The core is pure: it never touches a filesystem and never imports Convex.
 * A caller injects an {@link AgentFileReader} bound to a single org's
 * directory, which is also what makes cross-org isolation structural — a
 * reader can only ever see the org it was built for, so a listing cannot
 * accidentally span two organizations.
 *
 * One malformed file must not take a whole org's roster down, so listing
 * collects failures instead of throwing: each carries the offending path and
 * the reason, and the caller at the edge surfaces them (a log line, an admin
 * banner). Reading ONE named agent throws instead — there is no partial
 * answer to give.
 */

import {
  isValidAgentSlug,
  type AgentDefinition,
} from '../shared/schemas/agents';
import {
  canEditSkill,
  canViewSkill,
  type SkillViewer,
} from '../skills/visibility';
import { AgentParseError, parseAgentYaml } from './parse';

/**
 * The member asking for an agent, already verified as a member of the
 * organization whose tree is being read.
 *
 * `visibility` + `owner` mean exactly the same thing on an agent as on a
 * skill — one member's own, or the whole organization's — so the sharing
 * predicates are imported from the skills domain rather than restated here.
 * A second copy of that rule would be free to drift from it.
 */
export type AgentViewer = SkillViewer;

/** True when `viewer` may see `agent` and use it in a conversation. */
export const canViewAgent = canViewSkill;

/** True when `viewer` may edit or delete `agent`. */
export const canEditAgent = canEditSkill;

/**
 * Access to one organization's agent files. Implementations bind the org up
 * front; nothing below can widen that scope.
 */
export interface AgentFileReader {
  /** Slugs of the agent files present, in any order. */
  listSlugs(): Promise<readonly string[]>;
  /** Raw file text for `slug`, or `null` when the org has no such agent. */
  readAgentFile(slug: string): Promise<string | null>;
  /** How this reader names a slug's file, for error messages. */
  describe(slug: string): string;
}

/** An agent that parsed cleanly. */
export interface OrgAgent {
  readonly slug: string;
  /** The path this was read from, as the reader names it. */
  readonly path: string;
  readonly definition: AgentDefinition;
}

/** An agent file that could not be read, kept out of the listing. */
export interface AgentLoadFailure {
  readonly slug: string;
  readonly path: string;
  readonly message: string;
}

export interface AgentListing {
  /** Readable agents, sorted by slug for a stable order. */
  readonly agents: readonly OrgAgent[];
  /** Files that failed to load, sorted by slug. */
  readonly failures: readonly AgentLoadFailure[];
}

/**
 * Read one named agent. Returns `null` when the org has no such file; throws
 * {@link AgentParseError} — naming the path — when it has a broken one.
 */
export async function readOrgAgent(
  reader: AgentFileReader,
  slug: string,
): Promise<OrgAgent | null> {
  const path = reader.describe(slug);
  if (!isValidAgentSlug(slug)) {
    throw new AgentParseError(path, `"${slug}" is not a valid agent slug`);
  }
  const content = await reader.readAgentFile(slug);
  if (content === null) return null;

  const definition = parseAgentYaml(content, path);
  if (definition.name !== slug) {
    throw new AgentParseError(
      path,
      `name "${definition.name}" does not match the file name "${slug}"`,
    );
  }
  return { slug, path, definition };
}

/**
 * Read every agent the reader can see, without applying visibility. Use it
 * for administrative surfaces; member-facing listings go through
 * {@link listOrgAgents}.
 */
export async function readOrgAgents(
  reader: AgentFileReader,
): Promise<AgentListing> {
  const slugs = [...(await reader.listSlugs())].sort();
  const agents: OrgAgent[] = [];
  const failures: AgentLoadFailure[] = [];

  for (const slug of slugs) {
    try {
      const agent = await readOrgAgent(reader, slug);
      if (agent !== null) agents.push(agent);
    } catch (err) {
      failures.push({
        slug,
        path: reader.describe(slug),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { agents, failures };
}

/**
 * The agents `viewer` may use in this organization: every `org`-visible one
 * plus the viewer's own `private` ones. Failures are reported unfiltered — a
 * broken file is an operator problem regardless of whose agent it would have
 * been.
 */
export async function listOrgAgents(
  reader: AgentFileReader,
  viewer: AgentViewer,
): Promise<AgentListing> {
  const { agents, failures } = await readOrgAgents(reader);
  return {
    agents: agents.filter((agent) => canViewAgent(agent.definition, viewer)),
    failures,
  };
}
