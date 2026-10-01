/** Real Postgres proof of the organization's standard agent (migration 0146,
 * the `standard_agent` policy):
 *
 * - `project_agents.managed` is the migration's boolean, false by default,
 *   and at most one managed agent stands per project (its partial unique
 *   index);
 * - two hand-overs to the same project at the same moment create one agent,
 *   count it once, and both answer it;
 * - nobody edits the standard agent: a save answers `PROJECT_AGENT_MANAGED`
 *   and writes nothing;
 * - a start brings its row in line with what resolved — runtime, model,
 *   instructions and the document skills the project can still equip —
 *   and never waits for a row another start holds (`FOR UPDATE SKIP
 *   LOCKED`);
 * - a project with agents of its own is left to them
 *   (`STANDARD_AGENT_NOT_NEEDED`);
 * - switched off, the standard agent is created nowhere and starts nothing
 *   (`STANDARD_AGENT_OFF`, no run row), and a policy file that does not
 *   parse reads as unavailable, never as on.
 *
 * The lane resolves no model: creating one through the door needs a
 * servable model, which the policy's own unit tests and the live rig cover. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { resolveOrgSlug } from '../../lib/org-config.ts';
import { kickAgentRun } from '../tasks/agent-runs.ts';
import {
  alignManagedProjectAgent,
  getProjectAuthContext,
  insertManagedProjectAgent,
  updateProjectAgent,
} from './service.ts';
import { ensureStandardAgent } from './standard-agent.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

function codeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : String(error);
}

function reasonOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return undefined;
  }
  const data: unknown = error.data;
  return typeof data === 'object' &&
    data !== null &&
    'reason' in data &&
    typeof data.reason === 'string'
    ? data.reason
    : undefined;
}

export async function checkStandardAgent(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const projectId = randomUUID();
  const curatedProjectId = randomUUID();
  const emptyProjectId = randomUUID();
  const now = Date.now();

  const slug = await resolveOrgSlug(sql, orgId);
  if (!slug || !process.env.TALE_CONFIG_DIR) {
    throw new Error('Missing isolated policy fixture root');
  }
  const directory = path.join(process.env.TALE_CONFIG_DIR, slug, 'governance');
  await mkdir(directory, { recursive: true });
  const policy = path.join(directory, 'standard-agent.yml');
  const previous = await readFile(policy).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });

  try {
    for (const [id, name] of [
      [projectId, 'Standard agent lane'],
      [curatedProjectId, 'Standard agent lane (curated)'],
      [emptyProjectId, 'Standard agent lane (empty)'],
    ] as const) {
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                  updated_at_ms)
        VALUES (${id}, ${orgId}, ${name}, ${userId}, ${now}, ${now})
      `;
    }
    await sql`
      INSERT INTO app.project_agents (org_id, project_id, name, harness, model,
                                      created_by, created_at_ms, updated_at_ms)
      VALUES (${orgId}, ${curatedProjectId}, 'Curated', 'claude-code',
              'lane-model', ${userId}, ${now}, ${now})
    `;

    // ---- the migration's shape ---------------------------------------------
    const column = await sql<
      { type: string; nullable: string; fallback: string | null }[]
    >`
      SELECT data_type AS type, is_nullable AS nullable,
             column_default AS fallback
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'project_agents'
        AND column_name = 'managed'
    `;
    const index = await sql<{ definition: string }[]>`
      SELECT indexdef AS definition FROM pg_indexes
      WHERE schemaname = 'app' AND tablename = 'project_agents'
        AND indexname = 'project_agents_one_managed'
    `;
    record(
      'standard agent: managed is the migration’s boolean, one per project',
      column[0]?.type === 'boolean' &&
        column[0].nullable === 'NO' &&
        column[0].fallback === 'false' &&
        (index[0]?.definition.includes('UNIQUE') ?? false) &&
        (index[0]?.definition.includes('WHERE managed') ?? false),
      `column=${JSON.stringify(column)} index=${index[0]?.definition ?? 'missing'}`,
    );

    // ---- two hand-overs at once --------------------------------------------
    const auth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId,
      role: 'owner',
    });
    const fields = {
      name: 'Standard agent',
      harness: 'claude-code',
      model: 'lane-model',
      modelProvider: 'lane-provider',
      skills: ['docx', 'pptx'],
      instructions: 'Do the task.',
    };
    const project = { id: projectId, name: 'Standard agent lane' };
    const [first, second] = await Promise.all([
      transactSerializable(sql, (tx) =>
        insertManagedProjectAgent(tx, auth, project, fields),
      ),
      transactSerializable(sql, (tx) =>
        insertManagedProjectAgent(tx, auth, project, fields),
      ),
    ]);
    const managedRows = await sql<{ id: string }[]>`
      SELECT id FROM app.project_agents
      WHERE project_id = ${projectId} AND managed
    `;
    const counted = await sql<{ count: number }[]>`
      SELECT project_agent_count AS count FROM app.projects
      WHERE id = ${projectId}
    `;
    record(
      'standard agent: two hand-overs at once create one agent, counted once, and both answer it',
      managedRows.length === 1 &&
        first.agentId === second.agentId &&
        first.agentId === managedRows[0]?.id &&
        [first.created, second.created].filter(Boolean).length === 1 &&
        counted[0]?.count === 1,
      `rows=${managedRows.length} first=${JSON.stringify(first)} second=${JSON.stringify(second)} count=${counted[0]?.count}`,
    );

    // ---- nobody edits it ---------------------------------------------------
    let editRefusal = '';
    try {
      await transactSerializable(sql, (tx) =>
        updateProjectAgent(tx, auth, {
          agentId: first.agentId,
          name: 'Renamed by hand',
          harness: 'codex',
          model: 'other-model',
          skills: [],
          connectors: [],
        }),
      );
    } catch (error) {
      editRefusal = codeOf(error);
    }
    const afterEdit = await sql<{ name: string; harness: string }[]>`
      SELECT name, harness FROM app.project_agents WHERE id = ${first.agentId}
    `;
    record(
      'standard agent: a save of it answers PROJECT_AGENT_MANAGED and writes nothing',
      editRefusal === 'PROJECT_AGENT_MANAGED' &&
        afterEdit[0]?.name === 'Standard agent' &&
        afterEdit[0].harness === 'claude-code',
      `refusal=${editRefusal} row=${JSON.stringify(afterEdit[0])}`,
    );

    // ---- a start aligns the row, and never waits for it ---------------------
    const target = { id: first.agentId, organizationId: orgId, projectId };
    // An admin disabled `pptx` since the agent was set up: the start drops it.
    const resolved = {
      harness: 'claude-code',
      model: 'healed-model',
      modelProvider: 'lane-provider',
      skills: ['docx'],
      instructions: 'Do the task.',
    };
    // Another start holds the row: the alignment skips it at once.
    let whileHeld: boolean | undefined;
    let whileHeldMs = 0;
    await sql.begin(async (holder) => {
      await holder`
        SELECT id FROM app.project_agents WHERE id = ${first.agentId}
        FOR UPDATE
      `;
      const started = Date.now();
      whileHeld = await sql.begin((tx) =>
        alignManagedProjectAgent(tx, target, resolved),
      );
      whileHeldMs = Date.now() - started;
    });
    const healed = await sql.begin((tx) =>
      alignManagedProjectAgent(tx, target, resolved),
    );
    const again = await sql.begin((tx) =>
      alignManagedProjectAgent(tx, target, resolved),
    );
    const aligned = await sql<{ model: string; skills: string[] }[]>`
      SELECT model, skills FROM app.project_agents WHERE id = ${first.agentId}
    `;
    record(
      'standard agent: a start aligns its row once, dropping a skill gone since, and skips a row another start holds',
      whileHeld === false &&
        whileHeldMs < 2_000 &&
        healed &&
        !again &&
        aligned[0]?.model === 'healed-model' &&
        aligned[0].skills.join(',') === 'docx',
      `whileHeld=${String(whileHeld)} in ${whileHeldMs}ms healed=${String(healed)} again=${String(again)} model=${aligned[0]?.model} skills=${aligned[0]?.skills.join(',')}`,
    );

    // ---- a project with agents of its own ----------------------------------
    let curatedRefusal = '';
    try {
      await transactSerializable(sql, (tx) =>
        ensureStandardAgent(tx, auth, curatedProjectId),
      );
    } catch (error) {
      curatedRefusal = codeOf(error);
    }
    const curatedManaged = await sql<{ id: string }[]>`
      SELECT id FROM app.project_agents
      WHERE project_id = ${curatedProjectId} AND managed
    `;
    record(
      'standard agent: a project with agents of its own is left to them',
      curatedRefusal === 'STANDARD_AGENT_NOT_NEEDED' &&
        curatedManaged.length === 0,
      `refusal=${curatedRefusal} managed=${curatedManaged.length}`,
    );

    // ---- switched off ------------------------------------------------------
    await writeFile(policy, 'enabled: false\n');
    let offEnsure = '';
    try {
      await transactSerializable(sql, (tx) =>
        ensureStandardAgent(tx, auth, emptyProjectId),
      );
    } catch (error) {
      offEnsure = codeOf(error);
    }
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'Standard agent lane task',
        'in_progress', ${taskId}, 'agent', ${first.agentId}, ${userId}, 'user',
        ${now}, ${now})
    `;
    let offKick = '';
    try {
      await transactSerializable(sql, (tx) =>
        kickAgentRun(tx, {
          organizationId: orgId,
          projectId,
          taskId,
          agentId: first.agentId,
          harness: 'claude-code',
          model: 'lane-model',
          startedBy: userId,
        }),
      );
    } catch (error) {
      offKick = codeOf(error);
    }
    const offRows = await sql<{ id: string }[]>`
      SELECT id FROM app.project_agents
      WHERE project_id = ${emptyProjectId}
    `;
    const runs = await sql<{ id: string }[]>`
      SELECT id FROM app.project_agent_runs WHERE task_id = ${taskId}
    `;
    record(
      'standard agent: switched off, it is created nowhere and starts nothing',
      offEnsure === 'STANDARD_AGENT_OFF' &&
        offKick === 'STANDARD_AGENT_OFF' &&
        offRows.length === 0 &&
        runs.length === 0,
      `ensure=${offEnsure} kick=${offKick} rows=${offRows.length} runs=${runs.length}`,
    );

    // ---- a policy file that does not parse ---------------------------------
    await writeFile(policy, 'enabled: perhaps\n');
    let unreadable = '';
    let unreadableReason: string | undefined;
    try {
      await transactSerializable(sql, (tx) =>
        ensureStandardAgent(tx, auth, emptyProjectId),
      );
    } catch (error) {
      unreadable = codeOf(error);
      unreadableReason = reasonOf(error);
    }
    record(
      'standard agent: a policy file that does not parse reads as unavailable, never as on',
      unreadable === 'STANDARD_AGENT_UNAVAILABLE' &&
        unreadableReason === 'unreadable',
      `refusal=${unreadable} reason=${unreadableReason ?? 'none'}`,
    );
  } finally {
    // Cascades to their agents, tasks and runs.
    await sql`
      DELETE FROM app.projects
      WHERE id IN ${sql([projectId, curatedProjectId, emptyProjectId])}
    `;
    if (previous === null) await rm(policy, { force: true });
    else await writeFile(policy, previous);
  }
}
