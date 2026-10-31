/**
 * Real Postgres proof of who reads which projects (#5156). "Every project I
 * can read" is one relation that the all-projects task reads (the board,
 * search, the ops indicators) join in the statement that reads the tasks,
 * and the project lists read one page at a time. The readers that pick from
 * it or count it join it too (#5193): the document search, the project a
 * create that names none falls back to, and the chat hand-over's projects
 * with agents. The knowledge scopes hand the knowledge database the readable
 * projects that hold a document, read through it (#5202). Fixture rows go
 * in by SQL, in an organization of their own so
 * that no other lane's project counts; every read goes through the service.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { searchDocumentsView } from '../documents/service.ts';
import {
  getTaskOpsIndicators,
  getTaskOpsIndicatorsForAccessibleProjects,
  listTasksForAccessibleProjects,
  searchTasks,
} from '../tasks/service.ts';
import {
  fallbackProjectId,
  listProjectsOverview,
  listSidebarProjects,
  readableProjectsSql,
  readableProjectsWithDocuments,
  readProjectAgentCoverage,
  type ProjectAuthContext,
} from './service.ts';

interface FixtureProject {
  name: string;
  key: string;
  /** The project's teams; none opens it to the organization. */
  teamIds: string[];
  /** The legacy pair's team, its audience while `teamIds` is empty. */
  teamId?: string;
  archived?: boolean;
  pinned?: boolean;
  /** In another organization. */
  foreign?: boolean;
  /** Agents of its own: what the chat's hand-over note counts. */
  agents?: number;
}

/** Open to the whole organization: no teams, and no legacy pair's team. */
function isOrgWide(project: FixtureProject) {
  return project.teamIds.length === 0 && project.teamId === undefined;
}

/** The same ids, in any order. */
function sameIds(actual: Iterable<string>, expected: Iterable<string>) {
  const sort = (ids: Iterable<string>) => JSON.stringify([...ids].sort());
  return sort(actual) === sort(expected);
}

export async function checkProjectReads(
  sql: Sql,
  ctx: { userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const orgId = `itest-project-reads-${randomUUID()}`;
  const foreignOrgId = `itest-project-reads-${randomUUID()}`;
  const finance = randomUUID();
  const legal = randomUUID();
  // A token only this lane's task titles carry: the search finds no other.
  const term = `orbit${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  // Oldest first; the projects list reads them newest first.
  const fixtures: FixtureProject[] = [
    { name: 'open', key: 'OPEN', teamIds: [], pinned: true },
    { name: 'finance', key: 'FIN', teamIds: [finance], agents: 1 },
    { name: 'shared', key: 'SHR', teamIds: [finance, legal] },
    { name: 'legacy', key: 'LEG', teamIds: [], teamId: legal, agents: 2 },
    { name: 'archived', key: 'ARC', teamIds: [], archived: true, agents: 1 },
    { name: 'foreign', key: 'FOR', teamIds: [], foreign: true, agents: 1 },
  ];
  const projects = fixtures.map((fixture, index) =>
    Object.assign(fixture, {
      id: randomUUID(),
      taskId: randomUUID(),
      createdAt: now - (fixtures.length - index) * 1_000,
    }),
  );
  const named = (name: string) => {
    const project = projects.find((candidate) => candidate.name === name);
    if (project === undefined) throw new Error(`no fixture project ${name}`);
    return project;
  };
  const keyOf = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.key;

  const viewer = (
    role: string,
    teamIds: string[],
    projectScope?: string,
  ): ProjectAuthContext => ({
    organizationId: orgId,
    userId: ctx.userId,
    role,
    teamIds,
    ...(projectScope === undefined ? {} : { projectScope }),
  });
  const admin = viewer('admin', []);
  // Who reads what: the open project is everyone's, a team's project its
  // members', the legacy pair's its team's; nobody reads the archived one
  // where archived projects stay out, or another organization's.
  const viewers = [
    {
      who: 'an admin in no team [PROJ-R1]',
      auth: admin,
      reads: ['open', 'finance', 'shared', 'legacy'],
    },
    {
      who: 'a member of Finance [PROJ-R2]',
      auth: viewer('member', [finance]),
      reads: ['open', 'finance', 'shared'],
    },
    {
      who: 'an editor in Legal [PROJ-R2]',
      auth: viewer('editor', [legal]),
      reads: ['open', 'shared', 'legacy'],
    },
    {
      who: 'a member of no team [PROJ-R2]',
      auth: viewer('member', []),
      reads: ['open'],
    },
    {
      who: 'a disabled seat in Finance [PROJ-R2]',
      auth: viewer('disabled', [finance]),
      reads: [],
    },
    {
      who: "a key of the Finance project's own",
      auth: viewer('admin', [], named('finance').id),
      reads: ['finance'],
    },
  ];

  try {
    for (const [index, project] of projects.entries()) {
      const org = project.foreign === true ? foreignOrgId : orgId;
      // The agent count matches the agent rows, so the rollup repair that
      // may run meanwhile finds nothing to correct.
      await sql`
        INSERT INTO app.projects (id, org_id, name, key, team_ids, team_id,
          archived_at_ms, pinned_at_ms, project_agent_count, created_by,
          created_at_ms, updated_at_ms)
        VALUES (${project.id}, ${org}, ${`Reads ${project.name}`},
          ${project.key}, ${sql.array(project.teamIds)}::text[],
          ${project.teamId ?? null}, ${project.archived === true ? now : null},
          ${project.pinned === true ? now : null}, ${project.agents ?? 0},
          ${ctx.userId}, ${project.createdAt}, ${project.createdAt})
      `;
      for (let agent = 0; agent < (project.agents ?? 0); agent += 1) {
        await sql`
          INSERT INTO app.project_agents (id, org_id, project_id, name,
            harness, model, created_by, created_at_ms, updated_at_ms)
          VALUES (${randomUUID()}, ${org}, ${project.id},
            ${`Reads agent ${agent + 1}`}, 'claude-code', 'itest-model',
            ${ctx.userId}, ${now}, ${now})
        `;
      }
      await sql`
        INSERT INTO app.documents (org_id, title, project_id, created_by,
          created_at_ms, updated_at_ms)
        VALUES (${org}, ${`${term} ${project.name}`}, ${project.id},
          ${ctx.userId}, ${project.createdAt}, ${project.createdAt})
      `;
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          created_by, created_by_type, created_at_ms, updated_at_ms)
        VALUES (${project.taskId}, ${org}, ${project.id},
          ${`${term} ${project.name}`}, 'todo', ${`n${index}`},
          ${ctx.userId}, 'user', ${now}, ${now})
      `;
      // A running agent run and a pending review gate on every task: what
      // the ops indicators read for each project the viewer may read.
      await sql`
        INSERT INTO app.project_agent_runs (org_id, project_id, task_id,
          agent_id, exec_id, session_id, status, harness, model, started_by,
          started_at_ms, launched_at_ms, deadline_at_ms, updated_at_ms)
        VALUES (${org}, ${project.id}, ${project.taskId}, ${randomUUID()},
          ${`exec-${randomUUID().slice(0, 12)}`}, ${randomUUID()}, 'running',
          'claude-code', 'itest-model', ${ctx.userId}, ${now}, ${now},
          ${now + 3_600_000}, ${now})
      `;
      await sql`
        INSERT INTO app.approvals (id, org_id, resource_type, resource_id,
          priority, status, metadata, created_at_ms)
        VALUES (${randomUUID()}, ${org}, 'task_review', ${project.taskId},
          'high', 'pending',
          ${sql.json({
            taskId: project.taskId,
            projectId: project.id,
            round: 0,
            reviewer: { kind: 'user', userId: ctx.userId },
          })}, ${now})
      `;
    }
    // A hub file open to everyone: the hub's own rule, beside the projects'.
    const hubFile = await sql<{ id: string }[]>`
      INSERT INTO app.documents (org_id, title, created_by, created_at_ms,
        updated_at_ms)
      VALUES (${orgId}, ${`${term} hub`}, ${ctx.userId}, ${now}, ${now})
      RETURNING id
    `;

    for (const { who, auth, reads } of viewers) {
      const readable = reads.map((name) => named(name).id);
      const tasks = reads.map((name) => named(name).taskId);
      // The archived project is open to the organization: whoever reads
      // the open project reads it too where archived projects count.
      const searchable = reads.includes('open')
        ? [...readable, named('archived').id]
        : readable;

      const relation = await sql<{ projectId: string }[]>`
        SELECT project_id AS "projectId"
        FROM ${readableProjectsSql(sql, auth)} rp
      `;
      record(
        `project reads: ${who} reads exactly the projects the rules allow`,
        sameIds(
          relation.map((row) => row.projectId),
          readable,
        ),
        JSON.stringify(relation),
      );

      const board = await listTasksForAccessibleProjects(sql, auth);
      record(
        `project reads: the board of ${who} holds the tasks of exactly those projects, each with its key`,
        sameIds(
          board.tasks.map((task) => task.projectId),
          readable,
        ) &&
          board.tasks.every(
            (task) => task.projectKey === keyOf(task.projectId),
          ),
        JSON.stringify(
          board.tasks.map(({ projectId, projectKey }) => ({
            projectId,
            projectKey,
          })),
        ),
      );

      const hits = await searchTasks(sql, auth, { query: term });
      record(
        `project reads: a search by ${who} finds the tasks of those projects and the archived one, labelled archived`,
        sameIds(
          hits.map((hit) => hit.projectId),
          searchable,
        ) &&
          hits.every(
            (hit) =>
              hit.projectKey === keyOf(hit.projectId) &&
              (hit.projectArchived === true) ===
                (hit.projectId === named('archived').id),
          ),
        JSON.stringify(
          hits.map(({ projectId, projectKey, projectArchived }) => ({
            projectId,
            projectKey,
            projectArchived,
          })),
        ),
      );

      const ops = await getTaskOpsIndicatorsForAccessibleProjects(sql, auth);
      record(
        `project reads: the ops indicators of ${who} hold the runs and review gates of exactly those projects`,
        sameIds(ops.runningTaskIds, tasks) &&
          sameIds(
            ops.runs.map((run) => run.taskId),
            tasks,
          ) &&
          sameIds(
            ops.pendingReviews.map((review) => review.taskId),
            tasks,
          ),
        JSON.stringify({
          running: ops.runningTaskIds,
          runs: ops.runs.map((run) => run.taskId),
          reviews: ops.pendingReviews.map((review) => review.taskId),
        }),
      );

      // The palette's document search: a project's files as its tasks,
      // the archived project's included, labelled and sorted last.
      const files = await searchDocumentsView(sql, auth, term);
      const projectFiles = files.filter((hit) => hit.projectId !== undefined);
      record(
        `project reads: a document search by ${who} finds the files of exactly those projects and the archived one, labelled archived and last`,
        sameIds(
          projectFiles.map((hit) => hit.projectId ?? ''),
          searchable,
        ) &&
          projectFiles.every(
            (hit) =>
              (hit.projectArchived === true) ===
              (hit.projectId === named('archived').id),
          ) &&
          (!searchable.includes(named('archived').id) ||
            files.at(-1)?.projectId === named('archived').id),
        JSON.stringify(
          files.map(({ documentId, projectId, projectArchived }) => ({
            documentId,
            projectId,
            projectArchived,
          })),
        ),
      );

      // A task created with no project lands in the newest active project
      // open to everyone the viewer reads, else in the newest they read.
      const fallback =
        projects
          .filter((project) => reads.includes(project.name))
          .sort(
            (a, b) =>
              Number(isOrgWide(b)) - Number(isOrgWide(a)) ||
              b.createdAt - a.createdAt,
          )[0]?.id ?? null;
      const picked = await fallbackProjectId(sql, auth);
      record(
        `project reads: a create by ${who} that names no project falls back to the newest of those projects open to everyone`,
        picked === fallback,
        JSON.stringify({ picked, fallback }),
      );

      // The chat's hand-over note names the newest active projects with an
      // agent, one here, and counts the rest with and without one.
      const withAgents = projects
        .filter(
          (project) =>
            reads.includes(project.name) && (project.agents ?? 0) > 0,
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      const coverage = await readProjectAgentCoverage(sql, auth, 1);
      record(
        `project reads: the hand-over note of ${who} names the newest of those projects with an agent and counts the rest`,
        JSON.stringify(coverage) ===
          JSON.stringify({
            named: withAgents
              .slice(0, 1)
              .map((project) => `Reads ${project.name}`),
            withAgents: withAgents.length,
            withoutAgents: reads.length - withAgents.length,
          }),
        JSON.stringify(coverage),
      );

      // The knowledge scopes: every project here holds a document, so
      // exactly those projects, and the archived one too where the scope
      // keeps archived ones (the chat's), labelled.
      const knowledge = await readableProjectsWithDocuments(sql, auth);
      const knowledgeArchived = await readableProjectsWithDocuments(sql, auth, {
        includeArchived: true,
      });
      record(
        `project reads: the knowledge scopes of ${who} carry exactly those projects that hold a document, the archived one labelled where archived ones count`,
        sameIds(
          knowledge.map((project) => project.id),
          readable,
        ) &&
          knowledge.every((project) => !project.archived) &&
          sameIds(
            knowledgeArchived.map((project) => project.id),
            searchable,
          ) &&
          knowledgeArchived.every(
            (project) =>
              project.archived === (project.id === named('archived').id),
          ),
        JSON.stringify({ knowledge, knowledgeArchived }),
      );

      // The HTTP doors refuse a disabled seat before the lists read.
      if (auth.role === 'disabled') continue;

      // The projects list pages newest first: the last row of a page is
      // the cursor of the next, and only the last page says it is done.
      const newestFirst = projects
        .filter((project) => reads.includes(project.name))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((project) => project.id);
      const pages: { ids: string[]; hasMore: boolean }[] = [];
      let cursor: { at: number; id: string } | null = null;
      for (let page = 0; page < 10; page += 1) {
        const read = await listProjectsOverview(sql, auth, {
          limit: 2,
          cursor,
        });
        pages.push({
          ids: read.projects.map((project) => project.id),
          hasMore: read.hasMore,
        });
        const last = read.projects.at(-1);
        if (!read.hasMore || last === undefined) break;
        cursor = { at: last.createdAt, id: last.id };
      }
      record(
        `project reads: ${who} pages through exactly those projects, newest first, two at a time`,
        JSON.stringify(pages.flatMap((page) => page.ids)) ===
          JSON.stringify(newestFirst) &&
          pages.every((page) => page.ids.length <= 2) &&
          pages.every(
            (page, index) => page.hasMore === index < pages.length - 1,
          ),
        JSON.stringify(pages),
      );

      // Home's navigator: pinned projects first, then the most recent.
      const navigator = projects
        .filter((project) => reads.includes(project.name))
        .sort(
          (a, b) =>
            Number(b.pinned === true) - Number(a.pinned === true) ||
            b.createdAt - a.createdAt,
        )
        .map((project) => project.id);
      const first = await listSidebarProjects(sql, auth, 2);
      const whole = await listSidebarProjects(sql, auth, 100);
      record(
        `project reads: Home's navigator of ${who} reads one page of those projects, pinned first`,
        JSON.stringify(first.projects.map((project) => project.id)) ===
          JSON.stringify(navigator.slice(0, 2)) &&
          first.hasMore === navigator.length > 2 &&
          JSON.stringify(whole.projects.map((project) => project.id)) ===
            JSON.stringify(navigator) &&
          !whole.hasMore,
        JSON.stringify({
          first: first.projects.map((project) => project.id),
          firstHasMore: first.hasMore,
          whole: whole.projects.map((project) => project.id),
        }),
      );
    }

    const archivedToo = await listProjectsOverview(sql, admin, {
      includeArchived: true,
      limit: 100,
    });
    record(
      'project reads: the projects list holds the archived project when asked for archived ones',
      JSON.stringify(archivedToo.projects.map((project) => project.id)) ===
        JSON.stringify(
          ['archived', 'legacy', 'shared', 'finance', 'open'].map(
            (name) => named(name).id,
          ),
        ) && !archivedToo.hasMore,
      JSON.stringify(archivedToo.projects.map((project) => project.id)),
    );

    // The one-project reads join the project they have checked.
    const financeOps = await getTaskOpsIndicators(
      sql,
      admin,
      named('finance').id,
    );
    const financeTask = [named('finance').taskId];
    record(
      "project reads: one project's ops indicators hold its own run and review gate alone",
      sameIds(financeOps.runningTaskIds, financeTask) &&
        sameIds(
          financeOps.runs.map((run) => run.taskId),
          financeTask,
        ) &&
        sameIds(
          financeOps.pendingReviews.map((review) => review.taskId),
          financeTask,
        ),
      JSON.stringify({
        running: financeOps.runningTaskIds,
        runs: financeOps.runs.map((run) => run.taskId),
        reviews: financeOps.pendingReviews.map((review) => review.taskId),
      }),
    );
    const archivedHits = await searchTasks(sql, admin, {
      query: term,
      projectId: named('archived').id,
    });
    record(
      'project reads: a search of one archived project finds its task, labelled archived and keyed',
      archivedHits.length === 1 &&
        archivedHits[0]?.taskId === named('archived').taskId &&
        archivedHits[0]?.projectArchived === true &&
        archivedHits[0]?.projectKey === 'ARC',
      JSON.stringify(archivedHits),
    );

    const memberFiles = await searchDocumentsView(
      sql,
      viewer('member', []),
      term,
    );
    record(
      "project reads: a document search finds the hub's file open to everyone beside the project files",
      memberFiles.some(
        (hit) =>
          hit.documentId === hubFile[0]?.id && hit.projectId === undefined,
      ),
      JSON.stringify(memberFiles.map((hit) => hit.documentId)),
    );

    // Last, as it archives the open project: with no project open to
    // everyone left, the fallback is the newest project the caller reads.
    await sql`
      UPDATE app.projects SET archived_at_ms = ${now}
      WHERE id = ${named('open').id}
    `;
    const teamFallback = await fallbackProjectId(
      sql,
      viewer('member', [finance]),
    );
    record(
      'project reads: with no project open to everyone, a create that names none falls back to the newest project the member reads',
      teamFallback === named('shared').id,
      JSON.stringify({ teamFallback, shared: named('shared').id }),
    );

    // After the fallback, which it would win: a project open to everyone
    // that holds no document reaches no knowledge row, so the knowledge
    // scopes leave it out of what crosses to the knowledge database.
    const bare = randomUUID();
    await sql`
      INSERT INTO app.projects (id, org_id, name, key, team_ids, team_id,
        archived_at_ms, pinned_at_ms, project_agent_count, created_by,
        created_at_ms, updated_at_ms)
      VALUES (${bare}, ${orgId}, 'Reads bare', 'BAR',
        ${sql.array([] as string[])}::text[], ${null}, ${null}, ${null}, 0,
        ${ctx.userId}, ${now}, ${now})
    `;
    const relationWithBare = await sql<{ projectId: string }[]>`
      SELECT project_id AS "projectId"
      FROM ${readableProjectsSql(sql, admin, { includeArchived: true })} rp
    `;
    const knowledgeWithBare = await readableProjectsWithDocuments(sql, admin, {
      includeArchived: true,
    });
    record(
      'project reads: a readable project without a document stays out of the knowledge scopes',
      relationWithBare.some((row) => row.projectId === bare) &&
        sameIds(
          knowledgeWithBare.map((project) => project.id),
          ['open', 'finance', 'shared', 'legacy', 'archived'].map(
            (name) => named(name).id,
          ),
        ),
      JSON.stringify({ bare, knowledgeWithBare }),
    );
  } finally {
    // The live rows that background work acts on go; the projects and
    // their tasks stay in organizations of their own.
    await sql`
      DELETE FROM app.approvals WHERE org_id IN (${orgId}, ${foreignOrgId})
    `;
    await sql`
      DELETE FROM app.project_agent_runs
      WHERE org_id IN (${orgId}, ${foreignOrgId})
    `;
  }
}
