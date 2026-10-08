/**
 * 0.5 app migration 0166: handles for the agents that existed before 0165.
 *
 * Every agent gets the mention handle its name gives (`agentHandleBase`),
 * unique in its project: the agent created first keeps the clean handle and
 * a later one whose name gives the same takes `-02`, `-03` and on. A handle a
 * person of the organization answers to by id or email, or an automation by
 * its store name, is skipped the same way, so an agent never takes `@ops` from
 * the person whose email starts with it.
 *
 * Every agent also keeps what it answered to until now (`legacy_handles`): its
 * name with dots for spaces and without spaces. Comments and descriptions
 * written before this release say `@research.bot`; with the forms frozen here
 * they keep naming the same agent after it is renamed.
 *
 * A TypeScript data migration because both are the app's own rules
 * (`lib/shared/agent-handle.ts`, `lib/shared/mention-handles.ts`), which would
 * otherwise be frozen as a second copy in SQL. Every statement is written
 * here, against the schema as it stood at 0166: a database that jumps past
 * several releases runs this with the newest image's code, so only those pure
 * rules are imported.
 *
 * Idempotent: a re-run finds no agent without a handle or frozen forms.
 * Bounded: only the projects that have such an agent are read. Rolling-deploy
 * safe: the previous image neither reads nor writes either column, and an
 * agent it adds after this ran is filled on the next save of its project's
 * agents. `updated_at_ms` stays as it was (it is the precondition a full agent
 * save holds), no audit row is written (nobody changed the agent), and no
 * hint is sent (no screen of the previous image shows a handle).
 */

import type { TransactionSql } from 'postgres';

import { deriveAgentHandles } from '../../../lib/shared/agent-handle.ts';
import {
  agentLegacyHandleVariants,
  automationMentionEntry,
  memberMentionEntry,
  type MentionActorEntry,
  reservedAgentHandles,
} from '../../../lib/shared/mention-handles.ts';

interface AgentRow {
  id: string;
  projectId: string;
  orgId: string;
  name: string;
  handle: string | null;
  legacyHandles: string[] | null;
  createdAt: number;
}

export async function migrate(tx: TransactionSql): Promise<void> {
  const rows = await tx<AgentRow[]>`
    SELECT id, project_id AS "projectId", org_id AS "orgId", name, handle,
           legacy_handles AS "legacyHandles",
           created_at_ms::float8 AS "createdAt"
    FROM app.project_agents
    WHERE project_id IN (
      SELECT project_id FROM app.project_agents
      WHERE handle IS NULL OR legacy_handles IS NULL
    )
    ORDER BY project_id, created_at_ms, id
    FOR UPDATE
  `;
  if (rows.length === 0) return;

  const orgIds = [...new Set(rows.map((row) => row.orgId))];
  const entriesByOrg = new Map<string, MentionActorEntry[]>();
  const addEntry = (orgId: string, entry: MentionActorEntry) => {
    const list = entriesByOrg.get(orgId);
    if (list === undefined) entriesByOrg.set(orgId, [entry]);
    else list.push(entry);
  };
  // The auth tables exist wherever an agent does (an agent is created by a
  // signed-in person); the probe keeps a database restored without them from
  // failing the boot here.
  const authTables = await tx<{ ready: boolean }[]>`
    SELECT to_regclass('public."member"') IS NOT NULL
       AND to_regclass('public."user"') IS NOT NULL AS ready
  `;
  if (authTables[0]?.ready === true) {
    const members = await tx<
      {
        orgId: string;
        userId: string;
        email: string | null;
        name: string | null;
      }[]
    >`
      SELECT m."organizationId" AS "orgId", m."userId", u."email", u."name"
      FROM "member" m JOIN "user" u ON u."id" = m."userId"
      WHERE m."organizationId" = ANY(${orgIds})
    `;
    for (const member of members) {
      addEntry(
        member.orgId,
        memberMentionEntry({
          id: member.userId,
          name: member.name,
          email: member.email,
        }),
      );
    }
  }
  const automations = await tx<{ orgId: string; name: string }[]>`
    SELECT DISTINCT org_id AS "orgId", name
    FROM app.automations
    WHERE org_id = ANY(${orgIds})
  `;
  for (const automation of automations) {
    addEntry(
      automation.orgId,
      automationMentionEntry({ slug: automation.name }),
    );
  }

  const byProject = new Map<string, AgentRow[]>();
  for (const row of rows) {
    const list = byProject.get(row.projectId);
    if (list === undefined) byProject.set(row.projectId, [row]);
    else list.push(row);
  }

  const ids: string[] = [];
  const handles: string[] = [];
  const legacies: string[] = [];
  for (const agents of byProject.values()) {
    const orgId = agents[0]?.orgId ?? '';
    const minted = deriveAgentHandles(
      agents,
      reservedAgentHandles(entriesByOrg.get(orgId) ?? []),
    );
    for (const agent of agents) {
      const handle = minted.get(agent.id);
      const freeze = agent.legacyHandles === null;
      if (handle === undefined && !freeze) continue;
      ids.push(agent.id);
      // '' and 'null' mark "leave this column alone" in the set write below.
      handles.push(handle ?? '');
      legacies.push(
        freeze ? JSON.stringify(agentLegacyHandleVariants(agent.name)) : 'null',
      );
    }
  }
  if (ids.length === 0) return;

  await tx`
    UPDATE app.project_agents a SET
      handle = COALESCE(a.handle, NULLIF(v.handle, '')),
      legacy_handles = COALESCE(
        a.legacy_handles,
        CASE WHEN v.legacy = 'null' THEN NULL ELSE
          ARRAY(SELECT jsonb_array_elements_text(v.legacy::jsonb))
        END
      )
    FROM unnest(
      ${ids}::text[], ${handles}::text[], ${legacies}::text[]
    ) AS v(id, handle, legacy)
    WHERE a.id = v.id
      AND (a.handle IS NULL OR a.legacy_handles IS NULL)
  `;
}
