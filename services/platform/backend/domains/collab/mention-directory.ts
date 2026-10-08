import { isSerializationFailure } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { deriveAgentHandles } from '../../../lib/shared/agent-handle.ts';
import {
  agentLegacyHandleVariants,
  agentMentionEntry,
  automationMentionEntry,
  buildMentionHandleIndex,
  type MentionActorEntry,
  type MentionHandleIndex,
  memberMentionEntry,
  reservedAgentHandles,
} from '../../../lib/shared/mention-handles.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { hasProjectAccess } from '../../core/projects/access.ts';
import {
  addedMentions,
  findTaskMentions,
  mentionedRefs,
  type MentionTextMode,
  type MentionTextResult,
  normalizeMentionText,
  previousPlainHandles,
  previousTokenRefs,
  type ResolvedMention,
} from '../../core/tasks/mentions.ts';
import { listAutomations } from '../automations/store.ts';

/**
 * The mention DIRECTORY on Postgres — who `@handle` can name on a task
 * surface, and the preparation that gives a comment's or a task
 * description's text its stored form and its mentions.
 *
 * The rules:
 *
 *  - only members who can ACCESS the project are mentionable (the assignee
 *    picker's scoping — mentioning someone who cannot open the task is a
 *    notification they can do nothing with);
 *  - entries are listed members, then deployed automations, then the
 *    project's own agents, and a handle two of them answer to goes by the
 *    tiers of `lib/shared/mention-handles.ts`;
 *  - a token nobody claims is a miss reported back to the author, never a
 *    guessed agent: every agent a mention can reach is one of the project's
 *    agents, all of them listed here;
 *  - a leg that cannot be listed FAILS the build (`MentionDirectoryError`,
 *    503, retryable): a partial directory turns `@teammate` into plain text
 *    with no bell, no steer, no owning-automation run, and nothing tells the
 *    author. The "quiet refusal" contract covers PERMISSION misses (an
 *    outsider is not mentionable), never infrastructure failures; the
 *    surface fails loudly and the comment (or the task) is saved again.
 */

export interface MentionDirectory {
  entries: MentionActorEntry[];
  index: MentionHandleIndex;
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

async function accessibleMembers(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string | null },
): Promise<MentionActorEntry[]> {
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
  const toEntry = (row: (typeof rows)[number]): MentionActorEntry =>
    memberMentionEntry({
      id: row.userId,
      name: row.displayName,
      email: row.email,
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
  const entries: MentionActorEntry[] = [];
  try {
    entries.push(...(await accessibleMembers(sql, args)));
  } catch (error) {
    throw directoryUnavailable('members', error);
  }
  if (args.projectId === null) {
    // Org-wide surfaces (private agent chat) mention people only — agent
    // routing there is a different lane.
    return { entries, index: buildMentionHandleIndex(entries) };
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
      entries.push(
        automationMentionEntry({
          slug: automation.name,
          name: presentationName(automation.presentation) ?? null,
        }),
      );
    }
  } catch (error) {
    throw directoryUnavailable('automations', error);
  }

  // The project's agents go LAST, so within a tier their handles win a
  // clash and a mention reaches the agent lane.
  try {
    const agents = await sql<
      {
        id: string;
        name: string;
        handle: string | null;
        legacyHandles: string[] | null;
        createdAt: number;
      }[]
    >`
      SELECT id, name, handle, legacy_handles AS "legacyHandles",
             created_at_ms::float8 AS "createdAt"
      FROM app.project_agents
      WHERE project_id = ${args.projectId} AND org_id = ${args.organizationId}
      ORDER BY created_at_ms, id
    `;
    // An agent the previous release added during a deploy has no handle
    // yet: it answers to the one its project's next save will store, and to
    // its name's older forms.
    const derived = deriveAgentHandles(agents, reservedAgentHandles(entries));
    for (const agent of agents) {
      entries.push(
        agentMentionEntry({
          id: agent.id,
          name: agent.name,
          handle: agent.handle ?? derived.get(agent.id) ?? null,
          legacyHandles:
            agent.legacyHandles ?? agentLegacyHandleVariants(agent.name),
        }),
      );
    }
  } catch (error) {
    throw directoryUnavailable('agents', error);
  }

  return { entries, index: buildMentionHandleIndex(entries) };
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

export interface PreparedSurfaceText extends MentionTextResult {
  /** The mentions the text makes that `previousBody` did not — all of
   * `mentions` when no previous text was given. */
  added: ResolvedMention[];
  /** The same text per language, each given its stored form. */
  bodyByLocale?: Record<string, string>;
}

/**
 * Give one surface's text its stored form and say whom it names
 * (`normalizeMentionText` for the `mode`s). An EDIT passes the text it
 * replaces as `previousBody`: tokens already there are kept even when whoever
 * they name can no longer be mentioned, the plain handles already there stay
 * as typed, and `added` holds only who the edit newly names — both texts read
 * against this one directory, so rewording prose around an existing mention
 * does not fire it again. `prefer` (who a comment was saved naming) settles a
 * handle two people answer to.
 *
 * A text that mentions nobody is answered without building the directory,
 * and so is one in a mode that only checks tokens when it holds none.
 */
export async function prepareSurfaceText(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId?: string;
    body: string;
    cap: number;
    mode: MentionTextMode;
    previousBody?: string;
    prefer?: ReadonlySet<string>;
    bodyByLocale?: Record<string, string>;
  },
): Promise<PreparedSurfaceText> {
  const texts = [args.body, ...Object.values(args.bodyByLocale ?? {})];
  const occurrences = texts.flatMap((text) => findTaskMentions(text));
  const needsDirectory =
    args.mode === 'full'
      ? occurrences.length > 0
      : occurrences.some((occurrence) => occurrence.type === 'token');
  if (!needsDirectory) {
    return {
      text: args.body,
      mentions: [],
      added: [],
      unresolvedMentionTokens: [],
      invalidTokens: [],
      ...(args.bodyByLocale !== undefined
        ? { bodyByLocale: args.bodyByLocale }
        : {}),
    };
  }
  const directory = await buildMentionDirectory(sql, {
    organizationId: args.organizationId,
    projectId: args.projectId ?? null,
  });
  const edit =
    args.previousBody === undefined
      ? {}
      : {
          keepRefs: previousTokenRefs(args.previousBody),
          previousPlain: previousPlainHandles(args.previousBody),
        };
  const prepared = normalizeMentionText({
    body: args.body,
    index: directory.index,
    cap: args.cap,
    mode: args.mode,
    ...edit,
    ...(args.prefer !== undefined ? { prefer: args.prefer } : {}),
  });
  const added =
    args.previousBody === undefined
      ? prepared.mentions
      : addedMentions(
          normalizeMentionText({
            body: args.previousBody,
            index: directory.index,
            cap: args.cap,
            mode: 'verbatim',
            keepRefs: edit.keepRefs,
            ...(args.prefer !== undefined ? { prefer: args.prefer } : {}),
          }).mentions,
          prepared.mentions,
        );
  const bodyByLocale =
    args.bodyByLocale === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(args.bodyByLocale).map(([locale, text]) => [
            locale,
            normalizeMentionText({
              body: text,
              index: directory.index,
              cap: args.cap,
              mode: args.mode,
            }).text,
          ]),
        );
  return {
    ...prepared,
    added,
    ...(bodyByLocale !== undefined ? { bodyByLocale } : {}),
  };
}

/**
 * The CURRENT names of whoever the tokens of `texts` name, keyed `kind:id`,
 * in one read per kind: what a plain-text reader (a search snippet, an
 * activity line) and an agent read instead of the name a token was saved
 * with. Someone no longer in the organization is left out, and their token's
 * own label is read instead.
 */
export async function currentMentionNames(
  sql: Sql | TransactionSql,
  organizationId: string,
  texts: readonly string[],
): Promise<Map<string, string>> {
  const refs = mentionedRefs(texts);
  const names = new Map<string, string>();
  if (refs.user.size > 0) {
    const users = await sql<
      { id: string; name: string | null; email: string | null }[]
    >`
      SELECT u."id", u."name", u."email"
      FROM "user" u
      JOIN "member" m ON m."userId" = u."id"
        AND m."organizationId" = ${organizationId}
      WHERE u."id" = ANY(${[...refs.user]})
    `;
    for (const user of users) {
      names.set(
        `user:${user.id}`,
        memberMentionEntry({ id: user.id, name: user.name, email: user.email })
          .name,
      );
    }
  }
  if (refs.agent.size > 0) {
    const agents = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM app.project_agents
      WHERE org_id = ${organizationId} AND id = ANY(${[...refs.agent]})
    `;
    for (const agent of agents) names.set(`agent:${agent.id}`, agent.name);
  }
  if (refs.automation.size > 0) {
    // The newest presentation any version carries, as the automation list
    // reads it (`listAutomations`).
    const automations = await sql<{ name: string; presentation: unknown }[]>`
      SELECT name,
             (array_agg(presentation ORDER BY version DESC)
                FILTER (WHERE presentation IS NOT NULL
                          AND jsonb_typeof(presentation) <> 'null'))[1]
               AS presentation
      FROM app.automations
      WHERE org_id = ${organizationId} AND name = ANY(${[...refs.automation]})
      GROUP BY name
    `;
    for (const automation of automations) {
      names.set(
        `automation:${automation.name}`,
        automationMentionEntry({
          slug: automation.name,
          name: presentationName(automation.presentation) ?? null,
        }).name,
      );
    }
  }
  return names;
}
