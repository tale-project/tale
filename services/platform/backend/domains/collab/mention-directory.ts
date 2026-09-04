import type { Sql, TransactionSql } from 'postgres';

import { hasProjectAccess } from '../../core/projects/access.ts';
import {
  extractMentions,
  findUnresolvedMentionTokens,
  type MentionDirectoryEntry,
  type ResolvedMention,
} from '../../core/tasks/mentions.ts';
import { listAutomations } from '../automations/store.ts';

/**
 * The mention DIRECTORY on Postgres — who `@handle` can name on a task
 * surface, and the resolution that turns comment text into mentions.
 *
 * The 0.4 rules, kept exactly:
 *
 *  - only members who can ACCESS the project are mentionable (the assignee
 *    picker's scoping — mentioning someone who cannot open the task is a
 *    notification they can do nothing with);
 *  - handle precedence is insertion ORDER: listed agent slugs, then
 *    deployed automations, then the project's own agent INSTANCES last, so
 *    an instance handle shadows a same-named retired slug and the mention
 *    reaches the live lane;
 *  - an `agentMode` that is not `restricted` is PERMISSIVE: a token nobody
 *    claims is treated as an agent handle rather than reported unresolved;
 *  - a leg that cannot be listed FAILS the build (`MentionDirectoryError`,
 *    503, retryable) — 0.4 logged and skipped it, but a partial directory
 *    turns `@teammate` into plain text: no bell, no steer, no owning-
 *    automation run, and nothing tells the author. The "quiet refusal"
 *    contract covers PERMISSION misses (an outsider is not mentionable),
 *    never infrastructure failures; the surface fails loudly and the comment
 *    is posted again.
 *
 * The scanning itself (`extractMentions`, `findUnresolvedMentionTokens`,
 * `parseMentionTokens`) is REUSED from the 0.4 pure module: one grammar for
 * `@handle`, one place it can drift.
 */

export interface MentionDirectory {
  entries: MentionDirectoryEntry[];
  /** Non-restricted projects: an unclaimed token reads as an agent handle. */
  permissiveAgents: boolean;
}

export type MentionDirectoryLeg = 'members' | 'automations' | 'agents';

/**
 * A directory leg could not be listed. The task-comment door maps it to a
 * 503 with this code so the composer shows a failure the author can retry,
 * instead of a posted comment whose mentions silently did nothing.
 */
export class MentionDirectoryError extends Error {
  readonly code = 'MENTION_DIRECTORY_UNAVAILABLE';
  readonly status = 503;
  readonly leg: MentionDirectoryLeg;

  constructor(leg: MentionDirectoryLeg, cause: unknown) {
    super(`mention directory: ${leg} listing failed`, { cause });
    this.name = 'MentionDirectoryError';
    this.leg = leg;
  }
}

function directoryUnavailable(
  leg: MentionDirectoryLeg,
  cause: unknown,
): MentionDirectoryError {
  console.error(`[collab] mention directory: ${leg} listing failed`, cause);
  return new MentionDirectoryError(leg, cause);
}

function memberHandles(member: {
  userId: string;
  email: string | null;
  displayName: string | null;
}): string[] {
  const handles = new Set<string>([member.userId.toLowerCase()]);
  if (member.email !== null) {
    const local = member.email.split('@')[0];
    if (local) handles.add(local.toLowerCase());
  }
  if (member.displayName !== null) {
    const name = member.displayName.trim().toLowerCase();
    if (name !== '') {
      handles.add(name.replaceAll(/\s+/g, ''));
      handles.add(name.replaceAll(/\s+/g, '.'));
    }
  }
  return [...handles];
}

function automationHandles(name: string, displayName?: string): string[] {
  const handles = new Set<string>([name.toLowerCase()]);
  const normalized = (displayName ?? '').trim().toLowerCase();
  if (normalized !== '') {
    handles.add(normalized.replaceAll(/\s+/g, '.'));
    handles.add(normalized.replaceAll(/\s+/g, ''));
  }
  return [...handles];
}

/** A project agent instance answers to its display name AND its id, so a
 * picker-inserted token resolves even under `restricted` mode and two
 * same-named instances keep a collision-proof form. */
function agentInstanceHandles(name: string, instanceId: string): string[] {
  const normalized = name.trim().toLowerCase();
  const variants =
    normalized === ''
      ? []
      : [normalized.replaceAll(/\s+/g, '.'), normalized.replaceAll(/\s+/g, '')];
  return [...new Set([...variants, instanceId.toLowerCase()])];
}

async function accessibleMembers(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string | null },
): Promise<MentionDirectoryEntry[]> {
  const rows = await sql<
    {
      userId: string;
      role: string;
      email: string | null;
      displayName: string | null;
    }[]
  >`
    SELECT m."userId", m."role", u."email", u."name" AS "displayName"
    FROM "member" m JOIN "user" u ON u."id" = m."userId"
    WHERE m."organizationId" = ${args.organizationId}
      AND lower(m."role") <> 'disabled'
  `;
  const toEntry = (row: (typeof rows)[number]): MentionDirectoryEntry => ({
    type: 'user',
    id: row.userId,
    handles: memberHandles(row),
  });
  if (args.projectId === null) return rows.map(toEntry);

  // Project scoping through the SHARED access rule: an org-wide project
  // admits everyone, a team-scoped one admits its teams' members, and admins
  // always see it — the same predicate the assignee picker and every read
  // gate use, so a mentionable set can never disagree with who can open the
  // task.
  const projects = await sql<
    { teamId: string | null; sharedWithTeamIds: string[] | null }[]
  >`
    SELECT team_id AS "teamId",
           shared_with_team_ids AS "sharedWithTeamIds"
    FROM app.projects
    WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const project = projects[0];
  if (project === undefined) return [];
  const accessInput = {
    ...(project.teamId !== null ? { teamId: project.teamId } : {}),
    ...(project.sharedWithTeamIds !== null
      ? { sharedWithTeamIds: project.sharedWithTeamIds }
      : {}),
  };
  const teamRows = await sql<{ userId: string; teamId: string }[]>`
    SELECT "userId", "teamId" FROM "teamMember"
    WHERE "userId" = ANY(${rows.map((row) => row.userId)})
  `;
  const teamsByUser = new Map<string, string[]>();
  for (const row of teamRows) {
    const list = teamsByUser.get(row.userId);
    if (list) list.push(row.teamId);
    else teamsByUser.set(row.userId, [row.teamId]);
  }
  return rows
    .filter((row) =>
      hasProjectAccess(
        accessInput,
        teamsByUser.get(row.userId) ?? [],
        row.role,
      ),
    )
    .map(toEntry);
}

export async function buildMentionDirectory(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string | null },
): Promise<MentionDirectory> {
  const entries: MentionDirectoryEntry[] = [];
  try {
    entries.push(...(await accessibleMembers(sql, args)));
  } catch (error) {
    throw directoryUnavailable('members', error);
  }
  if (args.projectId === null) {
    // Org-wide surfaces (private agent chat) mention people only — agent
    // routing there is a different lane.
    return { entries, permissiveAgents: false };
  }

  const projects = await sql<
    {
      allowedAgentSlugs: string[] | null;
      recommendedAgentSlugs: string[] | null;
      agentMode: string | null;
    }[]
  >`
    SELECT allowed_agent_slugs AS "allowedAgentSlugs",
           recommended_agent_slugs AS "recommendedAgentSlugs",
           agent_mode AS "agentMode"
    FROM app.projects
    WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const project = projects[0];

  for (const slug of new Set([
    ...(project?.allowedAgentSlugs ?? []),
    ...(project?.recommendedAgentSlugs ?? []),
  ])) {
    entries.push({ type: 'agent', id: slug, handles: [slug.toLowerCase()] });
  }

  // Deployed automations VISIBLE from this project (bound to it, or
  // org-level). Mentioning a task's owning automation is the comment-side
  // run trigger; elsewhere the mention is presentational.
  try {
    const automations = await listAutomations(sql, args.organizationId);
    for (const automation of automations) {
      // Only DEPLOYED automations are mentionable — a draft has no run to
      // trigger and no presence on the board.
      if (automation.deployedVersion === null) continue;
      const bindings = automation.projectIds;
      if (bindings.length > 0 && !bindings.includes(args.projectId)) continue;
      entries.push({
        type: 'automation',
        id: automation.name,
        handles: automationHandles(
          automation.name,
          presentationName(automation.presentation),
        ),
      });
    }
  } catch (error) {
    throw directoryUnavailable('automations', error);
  }

  // The project's agent INSTANCES go LAST so their handles shadow a
  // same-named slug and a mention reaches the instance lane.
  try {
    const instances = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM app.project_agents
      WHERE project_id = ${args.projectId} AND org_id = ${args.organizationId}
    `;
    for (const instance of instances) {
      const handles = agentInstanceHandles(instance.name, instance.id);
      if (handles.length > 0) {
        entries.push({ type: 'agent', id: instance.id, handles });
      }
    }
  } catch (error) {
    throw directoryUnavailable('agents', error);
  }

  return {
    entries,
    permissiveAgents: (project?.agentMode ?? 'all') !== 'restricted',
  };
}

/** The base (English) display name out of an automation version's untyped
 * `presentation` blob, if it carries one. Handles are locale-independent, so
 * only the base name contributes. */
function presentationName(presentation: unknown): string | undefined {
  if (presentation === null || typeof presentation !== 'object') {
    return undefined;
  }
  const name = (presentation as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

export interface SurfaceMentionResolution {
  mentions: ResolvedMention[];
  unresolvedMentionTokens: string[];
}

/** Scan one surface's body against its directory — the 0.4
 * `resolveSurfaceMentions`. */
export async function resolveSurfaceMentions(
  sql: Sql | TransactionSql,
  args: { organizationId: string; body: string; projectId?: string },
): Promise<SurfaceMentionResolution> {
  const directory = await buildMentionDirectory(sql, {
    organizationId: args.organizationId,
    projectId: args.projectId ?? null,
  });
  return {
    mentions: extractMentions(
      args.body,
      directory.entries,
      directory.permissiveAgents,
    ),
    unresolvedMentionTokens: findUnresolvedMentionTokens(
      args.body,
      directory.entries,
      directory.permissiveAgents,
    ),
  };
}
