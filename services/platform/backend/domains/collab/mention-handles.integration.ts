/** Real Postgres proof: agents get their mention handles from the backfill,
 * older text keeps naming whom it named after a rename, and every saving
 * door stores a mention as whom it names — or as plain text when it names
 * someone who cannot be mentioned on the task. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { migrate as backfillAgentHandles } from '../../db/migrations/0166_project_agent_handles_backfill.ts';
import {
  buildMentionDirectory,
  prepareSurfaceText,
} from './mention-directory.ts';

interface AgentState {
  name: string;
  handle: string | null;
  legacyHandles: string[] | null;
  createdAt: number;
  updatedAt: number;
}

export async function checkMentionHandles(
  sql: Sql,
  ctx: {
    base: string;
    cookie: string;
    orgId: string;
    orgSlug: string;
    userId: string;
    restKey: string;
  },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { base, cookie, orgId, orgSlug, userId, restKey } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();

  // A teammate who can be mentioned, and a stranger from no organization
  // here whose id a pasted mention carries.
  const teammate = `mh-teammate-${suffix}`;
  const stranger = `mh-stranger-${suffix}`;
  for (const [id, name] of [
    [teammate, 'MH Teammate'],
    [stranger, 'Mallory'],
  ] as const) {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt",
                          "updatedAt")
      VALUES (${id}, ${name}, ${`${id}@example.com`}, true, ${new Date()},
              ${new Date()})
    `;
  }
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role",
                          "createdAt")
    VALUES (${`m-${teammate}`}, ${orgId}, ${teammate}, 'member', ${new Date()})
  `;

  const newProject = async (name: string) =>
    (
      await sql<{ id: string }[]>`
        INSERT INTO app.projects (org_id, name, created_by, created_at_ms,
                                  updated_at_ms)
        VALUES (${orgId}, ${name}, ${userId}, ${now}, ${now})
        RETURNING id
      `
    )[0]?.id ?? '';
  const projectId = await newProject('Mention handles project');
  const otherProjectId = await newProject('Mention handles elsewhere');

  // Agents as the release before handles wrote them: no handle, nothing
  // frozen. The order of creation decides who keeps the clean handle.
  const insertAgent = async (args: {
    projectId: string;
    name: string;
    at: number;
    handle?: string;
    legacyHandles?: string[];
  }) =>
    (
      await sql<{ id: string }[]>`
        INSERT INTO app.project_agents (
          org_id, project_id, name, harness, model, created_by,
          created_at_ms, updated_at_ms, handle, legacy_handles
        ) VALUES (
          ${orgId}, ${args.projectId}, ${args.name}, 'claude-code',
          'itest-model', ${userId}, ${args.at}, ${args.at},
          ${args.handle ?? null}, ${args.legacyHandles ?? null}
        ) RETURNING id
      `
    )[0]?.id ?? '';
  const reviewer = await insertAgent({
    projectId,
    name: 'PR Reviewer',
    at: now,
  });
  const opus = await insertAgent({
    projectId,
    name: 'My Opus Agent #3',
    at: now + 1,
  });
  const opusTwin = await insertAgent({
    projectId,
    name: 'My Opus Agent 3',
    at: now + 2,
  });
  const invoice = await insertAgent({
    projectId,
    name: '发票助手',
    at: now + 3,
  });
  // Named so its handle is the teammate's email name, and a deployed
  // automation's store name: both stay theirs [PROJ-R18].
  const teammateTwin = await insertAgent({
    projectId,
    name: `MH Teammate ${suffix}`,
    at: now + 4,
  });
  const desk = `mh-desk-${suffix}`;
  await sql`
    INSERT INTO app.automations (
      org_id, name, version, document, created_by, created_at_ms
    ) VALUES (
      ${orgId}, ${desk}, 1, ${sql.json({ steps: [] })}, ${userId}, ${now}
    )
  `;
  await sql`
    INSERT INTO app.automation_deployments (
      org_id, name, version, deployed_by, deployed_at_ms
    ) VALUES (${orgId}, ${desk}, 1, ${userId}, ${now})
  `;
  const deskTwin = await insertAgent({
    projectId,
    name: `MH Desk ${suffix}`,
    at: now + 5,
  });
  const elsewhere = await insertAgent({
    projectId: otherProjectId,
    name: 'Elsewhere Desk',
    at: now,
  });

  const agentStates = async (): Promise<Map<string, AgentState>> => {
    const rows = await sql<(AgentState & { id: string })[]>`
      SELECT id, name, handle, legacy_handles AS "legacyHandles",
             created_at_ms::float8 AS "createdAt",
             updated_at_ms::float8 AS "updatedAt"
      FROM app.project_agents WHERE project_id = ${projectId}
    `;
    return new Map(rows.map(({ id, ...state }) => [id, state]));
  };

  try {
    // ---- 0166, as the boot runs it ----------------------------------------
    await sql.begin((tx) => backfillAgentHandles(tx));
    const first = await agentStates();
    const handleOf = (states: Map<string, AgentState>, id: string) =>
      states.get(id)?.handle ?? null;
    const legacyOf = (states: Map<string, AgentState>, id: string) =>
      JSON.stringify(states.get(id)?.legacyHandles ?? null);
    const wantHandles: [string, string][] = [
      [reviewer, 'pr-reviewer'],
      [opus, 'my-opus-agent-3'],
      [opusTwin, 'my-opus-agent-3-02'],
      [invoice, 'agent'],
      [teammateTwin, `${teammate}-02`],
      [deskTwin, `${desk}-02`],
    ];
    record(
      'mention handles: the backfill gives every agent the handle its name gives, unique in its project and clear of people and automations',
      wantHandles.every(([id, want]) => handleOf(first, id) === want) &&
        legacyOf(first, reviewer) === '["pr.reviewer","prreviewer"]' &&
        legacyOf(first, invoice) === '[]' &&
        // A backfill is nobody's save: the precondition stamp stays.
        [...first.values()].every(
          (state) => state.updatedAt === state.createdAt,
        ),
      wantHandles
        .map(([id, want]) => `${handleOf(first, id)} (want ${want})`)
        .join(', ') +
        `; frozen=${legacyOf(first, reviewer)}/${legacyOf(first, invoice)}`,
    );

    // ---- the previous release renames an agent and adds one ---------------
    await sql`
      UPDATE app.project_agents SET name = 'Code Critic' WHERE id = ${reviewer}
    `;
    const straggler = await insertAgent({
      projectId,
      name: 'Late Agent',
      at: now + 6,
    });
    // A new agent whose handle is one of Code Critic's older forms, as this
    // release stores it.
    const newcomer = await insertAgent({
      projectId,
      name: 'PRReviewer',
      at: now + 7,
      handle: 'prreviewer',
      legacyHandles: [],
    });
    const directory = await buildMentionDirectory(sql, {
      organizationId: orgId,
      projectId,
    });
    const resolves = (handle: string) => {
      const entry = directory.index.resolve(handle);
      return entry === null ? 'nobody' : `${entry.kind}:${entry.id}`;
    };
    const wantOwners: [string, string][] = [
      ['pr.reviewer', `agent:${reviewer}`],
      ['prreviewer', `agent:${reviewer}`],
      ['pr-reviewer', `agent:${reviewer}`],
      [reviewer, `agent:${reviewer}`],
      ['my-opus-agent-3-02', `agent:${opusTwin}`],
      ['late-agent', `agent:${straggler}`],
      [teammate, `user:${teammate}`],
      [`${teammate}-02`, `agent:${teammateTwin}`],
      [desk, `automation:${desk}`],
      [`${desk}-02`, `agent:${deskTwin}`],
    ];
    record(
      'mention handles: older text keeps naming the renamed agent, over a newer agent and a person or automation of the same name [COLLAB-R11]',
      wantOwners.every(([handle, want]) => resolves(handle) === want),
      wantOwners
        .map(([handle, want]) => `${handle}→${resolves(handle)} (want ${want})`)
        .join(', '),
    );

    const legacyText = await prepareSurfaceText(sql, {
      organizationId: orgId,
      projectId,
      body: `@prreviewer and @pr.reviewer, also @${reviewer}`,
      cap: 10_000,
      mode: 'full',
    });
    const criticToken = `[@Code Critic](mention:agent/${reviewer})`;
    record(
      'mention handles: every older form of the renamed agent is stored as the agent, by its current name [COLLAB-R10]',
      legacyText.text ===
        `${criticToken} and ${criticToken}, also ${criticToken}` &&
        legacyText.mentions.length === 1 &&
        legacyText.mentions[0]?.id === reviewer,
      `text=${JSON.stringify(legacyText.text)}, mentions=${legacyText.mentions.map((m) => `${m.type}:${m.id}`).join(',')}`,
    );

    // ---- 0166 again: only the agent the previous release added changes ----
    await sql.begin((tx) => backfillAgentHandles(tx));
    const second = await agentStates();
    const unchanged = [...first.entries()].filter(([id, state]) => {
      const after = second.get(id);
      return (
        after !== undefined &&
        after.handle === state.handle &&
        JSON.stringify(after.legacyHandles) ===
          JSON.stringify(state.legacyHandles) &&
        after.updatedAt === state.updatedAt
      );
    }).length;
    record(
      'mention handles: the backfill run again fills only an agent added since, and leaves the rest as they were',
      unchanged === first.size &&
        handleOf(second, straggler) === 'late-agent' &&
        legacyOf(second, straggler) === '["late.agent","lateagent"]' &&
        handleOf(second, newcomer) === 'prreviewer' &&
        legacyOf(second, newcomer) === '[]',
      `unchanged=${unchanged}/${first.size}, late=${handleOf(second, straggler)}/${legacyOf(second, straggler)}, newcomer=${handleOf(second, newcomer)}/${legacyOf(second, newcomer)}`,
    );

    // ---- the app's comment door --------------------------------------------
    const taskRows = await sql<{ id: string }[]>`
      INSERT INTO app.tasks (
        org_id, project_id, title, status, rank, created_by, created_by_type,
        created_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, 'Mention handles task', 'todo', 'a0',
        ${userId}, 'user', ${now}, ${now}
      ) RETURNING id
    `;
    const taskId = taskRows[0]?.id ?? '';
    const posted = await fetch(
      `${base}/api/app/tasks/${taskId}/comments?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({
          body: `@${teammate} please check with [@Mallory](mention:user/${stranger}) and [@Elsewhere Desk](mention:agent/${elsewhere})`,
        }),
      },
    );
    const answer = z
      .looseObject({
        messageId: z.string(),
        unresolvedMentionTokens: z.array(z.string()),
      })
      .safeParse(await posted.json().catch(() => null));
    const messageId = answer.success ? answer.data.messageId : '';
    const stored = (
      await sql<{ text: string }[]>`
        SELECT text FROM app.messages WHERE id = ${messageId}
      `
    )[0]?.text;
    const bells = async (recipient: string) =>
      (
        await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM app.user_notifications
          WHERE user_id = ${recipient} AND type = 'mention'
        `
      )[0]?.count ?? -1;
    const teammateBells = await bells(teammate);
    const strangerBells = await bells(stranger);
    const wantComment = `[@MH Teammate](mention:user/${teammate}) please check with \\@Mallory and \\@Elsewhere Desk`;
    record(
      'mention handles: a comment stores the teammate it names, and a pasted mention of a stranger or another project agent as plain text [COLLAB-R12]',
      posted.status === 200 &&
        stored === wantComment &&
        answer.success &&
        answer.data.unresolvedMentionTokens.includes('Mallory') &&
        answer.data.unresolvedMentionTokens.includes('Elsewhere Desk') &&
        teammateBells === 1 &&
        strangerBells === 0,
      `status=${posted.status}, stored=${JSON.stringify(stored)} (want ${JSON.stringify(wantComment)}), unresolved=${answer.success ? answer.data.unresolvedMentionTokens.join(',') : 'ERR'}, bells=${teammateBells}/${strangerBells} (want 1/0)`,
    );

    // ---- the API's task intake: a script's text, then a GitHub mirror ------
    const intake = async (externalSystem: string) => {
      const externalId = randomUUID();
      const response = await fetch(
        `${base}/api/v1/projects/${projectId}/tasks`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${restKey}`,
            'x-organization-slug': orgSlug,
          },
          body: JSON.stringify({
            externalSystem,
            externalId,
            title: `Mention intake ${externalSystem}`,
            description: `@my-opus-agent-3-02 and [@Mallory](mention:user/${stranger}) take this`,
          }),
        },
      );
      const rows = await sql<{ description: string | null }[]>`
        SELECT description FROM app.tasks
        WHERE org_id = ${orgId} AND external_system = ${externalSystem}
          AND external_id = ${externalId}
      `;
      return { status: response.status, description: rows[0]?.description };
    };
    const scripted = await intake('itest-script');
    const mirrored = await intake('github');
    const wantScripted = `[@My Opus Agent 3](mention:agent/${opusTwin}) and \\@Mallory take this`;
    const wantMirrored = '@my-opus-agent-3-02 and \\@Mallory take this';
    record(
      "mention handles: the API's task intake stores a script's mentions as whom they name, keeps a GitHub issue's as written, and stores a stranger's as plain text in both [COLLAB-R10] [COLLAB-R12]",
      scripted.status === 201 &&
        scripted.description === wantScripted &&
        mirrored.status === 201 &&
        mirrored.description === wantMirrored,
      `script=${scripted.status} ${JSON.stringify(scripted.description)} (want ${JSON.stringify(wantScripted)}), github=${mirrored.status} ${JSON.stringify(mirrored.description)} (want ${JSON.stringify(wantMirrored)})`,
    );
  } finally {
    await sql`
      DELETE FROM app.automation_deployments
      WHERE org_id = ${orgId} AND name = ${desk}
    `;
    await sql`
      DELETE FROM app.automations WHERE org_id = ${orgId} AND name = ${desk}
    `;
    await sql`DELETE FROM "member" WHERE "id" = ${`m-${teammate}`}`;
  }
}
