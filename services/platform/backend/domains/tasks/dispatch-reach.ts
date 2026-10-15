import {
  storedProjectDispatchSchema,
  type DispatchServedByStatus,
  type DispatchServingAgent,
  type DispatchSourceSkipReason,
  type ProjectDispatch,
  type ProjectDispatchSource,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import { readDispatchRow } from './dispatch-store.ts';
import { memberEditableProjects } from './edit-right.ts';

/**
 * How far a project's dispatch reaches beyond its own board (`sources`,
 * `@tale/shared/schemas/project-dispatch`): the one reach check every door
 * that lets an agent near a task asks — the pass that takes ready work, the
 * start that locks the agent, the assignment of a task, the scope of a
 * run's task tools, and who reviews the work.
 *
 * A dispatch reaches one of its sources while the project is in the same
 * organization, is not archived, and whoever last saved the dispatch may
 * still edit it ({@link memberEditableProjects}). Saving it with that source
 * needed that right (`dispatch-config.ts`); it is judged again at every use,
 * so a source that disappears, is archived, or whose right was lost is
 * skipped from then on — with why, in the pass and the readback — and never
 * reached on anyone else's rights.
 *
 * While it reaches a source, the dispatch's agents — its pool, its standing
 * roles' agents and its reviewers ({@link dispatchReachAgents}) — may be
 * assigned to, started on and work the tasks of that board as if it were
 * their own project's. Every other agent, and every other project, reaches
 * only its own board. A project whose dispatch is stored in a shape this
 * version cannot read reaches nothing beyond its own board.
 */

/** A source of a dispatch, judged now: reachable (`skipped` null), or not,
 * and why. `name` is the project's while it is in the organization. */
export interface JudgedSource {
  source: ProjectDispatchSource;
  projectId: string;
  name: string | null;
  skipped: DispatchSourceSkipReason | null;
}

/** What one source of a dispatch is, as its judgment reads it. */
export interface SourceFacts {
  /** The project is in the dispatch's organization. */
  exists: boolean;
  archived: boolean;
  /** Whoever last saved the dispatch may edit the project now. */
  authorityMayEdit: boolean;
}

/** Why a dispatch does not reach a source, or null when it does: a missing
 * project first, then an archived one, then a lost right. */
export function judgeSource(
  facts: SourceFacts,
): DispatchSourceSkipReason | null {
  if (!facts.exists) return 'missing';
  if (facts.archived) return 'archived';
  if (!facts.authorityMayEdit) return 'no_authority';
  return null;
}

/** The agents a dispatch takes beyond its own board: its pool, its
 * standing roles' agents and its reviewers. */
export function dispatchReachAgents(config: ProjectDispatch): Set<string> {
  return new Set([
    ...config.agents,
    ...(config.standingRoles ?? []).map((role) => role.agentId),
    ...(config.reviewers ?? []),
  ]);
}

/** The columns a source's ready work is taken from: its own, or the
 * dispatch's. */
export function sourceStatuses(
  config: Pick<ProjectDispatch, 'statuses'>,
  source: ProjectDispatchSource,
): ProjectDispatch['statuses'] {
  return source.statuses ?? config.statuses;
}

/**
 * Judge every source of a dispatch now, in the order it lists them. The
 * authority is whoever last saved the dispatch (`updated_by`); a dispatch
 * nobody saved reaches no source.
 */
export async function judgeDispatchSources(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sources: readonly ProjectDispatchSource[];
    authorityUserId: string | null;
  },
): Promise<JudgedSource[]> {
  if (args.sources.length === 0) return [];
  const ids = args.sources.map((source) => source.projectId);
  const projects = await sql<{ id: string; name: string; archived: boolean }[]>`
    SELECT id, name, archived_at_ms IS NOT NULL AS archived
    FROM app.projects
    WHERE org_id = ${args.organizationId} AND id = ANY(${ids})
  `;
  const byId = new Map(projects.map((project) => [project.id, project]));
  const editable =
    args.authorityUserId === null
      ? new Set<string>()
      : await memberEditableProjects(sql, {
          organizationId: args.organizationId,
          userId: args.authorityUserId,
          projectIds: projects
            .filter((project) => !project.archived)
            .map((project) => project.id),
        });
  return args.sources.map((source) => {
    const project = byId.get(source.projectId);
    return {
      source,
      projectId: source.projectId,
      name: project?.name ?? null,
      skipped: judgeSource({
        exists: project !== undefined,
        archived: project?.archived === true,
        authorityMayEdit: editable.has(source.projectId),
      }),
    };
  });
}

/** A project's stored dispatch with who last saved it, or null when it has
 * none, or one this version cannot read (which reaches nothing). */
async function readReachingDispatch(
  sql: Sql | TransactionSql,
  organizationId: string,
  projectId: string,
): Promise<{ config: ProjectDispatch; updatedBy: string | null } | null> {
  const stored = await readDispatchRow(sql, organizationId, projectId);
  if (stored === null || stored === 'unreadable') return null;
  return { config: stored.config, updatedBy: stored.updatedBy };
}

/** Whether a project's dispatch reaches another project as a source now. */
export async function dispatchReachesSource(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    dispatchProjectId: string;
    projectId: string;
  },
): Promise<boolean> {
  const dispatch = await readReachingDispatch(
    sql,
    args.organizationId,
    args.dispatchProjectId,
  );
  const source = dispatch?.config.sources?.find(
    (candidate) => candidate.projectId === args.projectId,
  );
  if (dispatch === null || source === undefined) return false;
  const [judged] = await judgeDispatchSources(sql, {
    organizationId: args.organizationId,
    sources: [source],
    authorityUserId: dispatch.updatedBy,
  });
  return judged?.skipped === null;
}

/** Where an agent may act: its own project, and the boards its project's
 * dispatch reaches when the agent is one of that dispatch's agents. */
export interface AgentReach {
  homeProjectId: string;
  /** The other projects it reaches now, in the order its dispatch lists
   * them; empty for most agents. */
  reachedProjectIds: string[];
}

/** An agent's reach now, or null when no agent of the organization has
 * that id. The agent's own project must be active for it to reach any
 * other. */
export async function readAgentReach(
  sql: Sql | TransactionSql,
  args: { organizationId: string; agentId: string },
): Promise<AgentReach | null> {
  const agent = await readAgentHome(sql, args);
  if (agent === null) return null;
  return reachFromHome(sql, { ...args, ...agent });
}

/** The agent's own project, and whether that project is archived. */
async function readAgentHome(
  sql: Sql | TransactionSql,
  args: { organizationId: string; agentId: string },
): Promise<{ projectId: string; archived: boolean } | null> {
  const agents = await sql<{ projectId: string; archived: boolean }[]>`
    SELECT a.project_id AS "projectId",
           p.archived_at_ms IS NOT NULL AS archived
    FROM app.project_agents a
    JOIN app.projects p ON p.id = a.project_id AND p.org_id = a.org_id
    WHERE a.id = ${args.agentId} AND a.org_id = ${args.organizationId}
    LIMIT 1
  `;
  return agents[0] ?? null;
}

async function reachFromHome(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    agentId: string;
    projectId: string;
    archived: boolean;
  },
): Promise<AgentReach> {
  const home = { homeProjectId: args.projectId, reachedProjectIds: [] };
  if (args.archived) return home;
  const dispatch = await readReachingDispatch(
    sql,
    args.organizationId,
    args.projectId,
  );
  if (
    dispatch === null ||
    (dispatch.config.sources ?? []).length === 0 ||
    !dispatchReachAgents(dispatch.config).has(args.agentId)
  ) {
    return home;
  }
  const judged = await judgeDispatchSources(sql, {
    organizationId: args.organizationId,
    sources: dispatch.config.sources ?? [],
    authorityUserId: dispatch.updatedBy,
  });
  return {
    homeProjectId: args.projectId,
    reachedProjectIds: judged
      .filter((source) => source.skipped === null)
      .map((source) => source.projectId),
  };
}

/** Whether an agent may act on a project's tasks: it is the agent's own
 * project, or one the agent's project's dispatch reaches for it. */
export async function agentReachesProject(
  sql: Sql | TransactionSql,
  args: { organizationId: string; agentId: string; projectId: string },
): Promise<boolean> {
  const agent = await readAgentHome(sql, args);
  if (agent === null) return false;
  // Its own project needs no dispatch to read.
  if (agent.projectId === args.projectId) return true;
  const reach = await reachFromHome(sql, {
    organizationId: args.organizationId,
    agentId: args.agentId,
    ...agent,
  });
  return reach.reachedProjectIds.includes(args.projectId);
}

/** Whether an authority resolved for a run reaches a project: its own, or
 * one of the projects its dispatch reaches. */
export function authorityReaches(
  authority: { projectId: string; reachedProjectIds?: readonly string[] },
  projectId: string,
): boolean {
  return (
    authority.projectId === projectId ||
    (authority.reachedProjectIds ?? []).includes(projectId)
  );
}

/** A dispatch of another project that lists a project among its sources,
 * with that source judged now. */
interface ServingDispatch {
  projectId: string;
  name: string;
  enabled: boolean;
  config: ProjectDispatch;
  skipped: DispatchSourceSkipReason | null;
}

/** Every dispatch of another active project that lists this one among its
 * sources, each with its source judged now, by project name. A dispatch
 * this version cannot read is left out: it serves nothing here. */
async function readServingDispatches(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string },
): Promise<ServingDispatch[]> {
  const rows = await sql<
    {
      projectId: string;
      name: string;
      enabled: boolean;
      config: unknown;
      updatedBy: string | null;
    }[]
  >`
    SELECT d.project_id AS "projectId", p.name, d.enabled, d.config,
           d.updated_by AS "updatedBy"
    FROM app.project_dispatch d
    JOIN app.projects p ON p.id = d.project_id AND p.org_id = d.org_id
    WHERE d.org_id = ${args.organizationId}
      AND p.archived_at_ms IS NULL
      AND d.project_id <> ${args.projectId}
      AND d.config -> 'sources' @> ${sql.json([{ projectId: args.projectId }])}
    ORDER BY p.name, d.project_id
  `;
  const serving: ServingDispatch[] = [];
  for (const row of rows) {
    const parsed = storedProjectDispatchSchema.safeParse(row.config);
    if (!parsed.success) continue;
    const source = parsed.data.sources?.find(
      (candidate) => candidate.projectId === args.projectId,
    );
    if (source === undefined) continue;
    const [judged] = await judgeDispatchSources(sql, {
      organizationId: args.organizationId,
      sources: [source],
      authorityUserId: row.updatedBy,
    });
    serving.push({
      projectId: row.projectId,
      name: row.name,
      enabled: row.enabled,
      config: parsed.data,
      skipped: judged === undefined ? 'missing' : judged.skipped,
    });
  }
  return serving;
}

/**
 * The dispatches of other projects that list this one among their sources,
 * each with whether it reaches this project now: what a board says about
 * who serves it. Archived projects' dispatches serve nothing and are left
 * out.
 */
export async function dispatchesServing(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string },
): Promise<DispatchServedByStatus[]> {
  return (await readServingDispatches(sql, args)).map((serving) => ({
    projectId: serving.projectId,
    name: serving.name,
    enabled: serving.enabled,
    reachable: serving.skipped === null,
    skipped: serving.skipped,
  }));
}

/**
 * The agents other projects' dispatches put to work on this board now: the
 * pool, the standing roles' agents and the reviewers of every dispatch that
 * lists it among its sources and reaches it ({@link dispatchReachAgents}),
 * each with its own project. A board names them in its history, and offers
 * them where it offers its own agents to assign and to review; a dispatch
 * that skips the board puts none of its agents there.
 */
export async function agentsServingProject(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string },
): Promise<DispatchServingAgent[]> {
  const reaching = (await readServingDispatches(sql, args)).filter(
    (serving) => serving.skipped === null,
  );
  const wanted = reaching.flatMap((serving) =>
    [...dispatchReachAgents(serving.config)].map((agentId) => ({
      agentId,
      projectId: serving.projectId,
    })),
  );
  if (wanted.length === 0) return [];
  const agents = await sql<
    { id: string; name: string; tools: string[] | null; projectId: string }[]
  >`
    SELECT id, name, tools, project_id AS "projectId"
    FROM app.project_agents
    WHERE org_id = ${args.organizationId}
      AND id = ANY(${wanted.map((agent) => agent.agentId)})
  `;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const projectName = new Map(
    reaching.map((serving) => [serving.projectId, serving.name]),
  );
  const listed: DispatchServingAgent[] = [];
  const seen = new Set<string>();
  for (const { agentId, projectId } of wanted) {
    const agent = byId.get(agentId);
    // Only the dispatch's own project's agents: one that moved or is gone
    // is not put to work here.
    if (agent?.projectId !== projectId || seen.has(agentId)) continue;
    seen.add(agentId);
    listed.push({
      agentId,
      name: agent.name,
      tools: agent.tools ?? [],
      projectId,
      projectName: projectName.get(projectId) ?? '',
    });
  }
  return listed;
}

/** What a source's readback states besides its judgment: its columns and
 * its label filter. */
export function sourceView(
  config: Pick<ProjectDispatch, 'statuses'>,
  judged: JudgedSource,
) {
  return {
    projectId: judged.projectId,
    name: judged.name,
    reachable: judged.skipped === null,
    skipped: judged.skipped,
    statuses: [...sourceStatuses(config, judged.source)],
    labels: judged.source.labels ?? null,
  };
}
