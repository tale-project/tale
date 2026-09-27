import { isSerializationFailure } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { hasProjectAccess } from '../../core/projects/access.ts';
import {
  addedMentions,
  extractMentions,
  findUnresolvedMentionTokens,
  type MentionDirectoryEntry,
  type ResolvedMention,
} from '../../core/tasks/mentions.ts';
import { listAutomations } from '../automations/store.ts';

/**
 * The mention DIRECTORY on Postgres — who `@handle` can name on a task
 * surface, and the resolution that turns a comment's or a task
 * description's text into mentions.
 *
 * The 0.4 rules, kept exactly:
 *
 *  - only members who can ACCESS the project are mentionable (the assignee
 *    picker's scoping — mentioning someone who cannot open the task is a
 *    notification they can do nothing with);
 *  - handle precedence is insertion ORDER: members, then deployed
 *    automations, then the project's own agent INSTANCES last, so an
 *    instance handle wins a clash and the mention reaches the live lane;
 *  - a token nobody claims is a miss reported back to the author, never a
 *    guessed agent: every agent a mention can reach is one of the project's
 *    instances, all of them listed here;
 *  - a leg that cannot be listed FAILS the build (`MentionDirectoryError`,
 *    503, retryable) — 0.4 logged and skipped it, but a partial directory
 *    turns `@teammate` into plain text: no bell, no steer, no owning-
 *    automation run, and nothing tells the author. The "quiet refusal"
 *    contract covers PERMISSION misses (an outsider is not mentionable),
 *    never infrastructure failures; the surface fails loudly and the comment
 *    (or the task) is saved again.
 *
 * The scanning itself (`extractMentions`, `findUnresolvedMentionTokens`,
 * `parseMentionTokens`) is REUSED from the 0.4 pure module: one grammar for
 * `@handle`, one place it can drift.
 */

export interface MentionDirectory {
  entries: MentionDirectoryEntry[];
}

export type MentionDirectoryLeg = 'members' | 'automations' | 'agents';

/**
 * A directory leg could not be listed. The task doors (a comment, a task
 * created or edited with a description that names someone) map it to a 503
 * with this code so the author sees a failure they can retry, instead of a
 * saved text whose mentions silently did nothing.
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

function directoryUnavailable(leg: MentionDirectoryLeg, cause: unknown): Error {
  // A serialization conflict is not an outage but the transaction's own
  // retry signal. `transactSerializable` reads the SQLSTATE off the error it
  // catches, so a wrapped one surfaced as a 503 instead of a rerun.
  if (cause instanceof Error && isSerializationFailure(cause)) return cause;
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

/** A project agent instance answers to its display name AND its id, so two
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
  const projects = await sql<{ teamIds: string[] | null }[]>`
    SELECT ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects
    WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const project = projects[0];
  if (project === undefined) return [];
  const accessInput = { teamIds: project.teamIds ?? [] };
  // Memberships IN THIS ORGANIZATION only — a team another tenant granted
  // must never make a member mentionable on a project here.
  const teamRows = await sql<{ userId: string; teamId: string }[]>`
    SELECT tm."userId", tm."teamId"
    FROM "teamMember" tm
    JOIN "team" t ON t."id" = tm."teamId"
    WHERE tm."userId" = ANY(${rows.map((row) => row.userId)})
      AND t."organizationId" = ${args.organizationId}
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
    return { entries };
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

  // The project's agent INSTANCES go LAST so their handles win a clash and
  // a mention reaches the instance lane.
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

  return { entries };
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
  /** The mentions the body makes that `previousBody` did not — all of
   * `mentions` when no previous text was given. */
  added: ResolvedMention[];
  unresolvedMentionTokens: string[];
}

/** Scan one surface's body against its directory — the 0.4
 * `resolveSurfaceMentions`. An EDIT passes the text it replaces as
 * `previousBody`: both texts are read against this one directory, so
 * `added` holds only who the edit newly names. Rewording prose around an
 * existing `@handle` must not fire it again, and a handle that resolves
 * today in both texts is not new just because it did not resolve when the
 * old text was saved. */
export async function resolveSurfaceMentions(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    body: string;
    projectId?: string;
    previousBody?: string;
  },
): Promise<SurfaceMentionResolution> {
  const directory = await buildMentionDirectory(sql, {
    organizationId: args.organizationId,
    projectId: args.projectId ?? null,
  });
  const mentions = extractMentions(args.body, directory.entries);
  return {
    mentions,
    added:
      args.previousBody === undefined
        ? mentions
        : addedMentions(
            extractMentions(args.previousBody, directory.entries),
            mentions,
          ),
    unresolvedMentionTokens: findUnresolvedMentionTokens(
      args.body,
      directory.entries,
    ),
  };
}
