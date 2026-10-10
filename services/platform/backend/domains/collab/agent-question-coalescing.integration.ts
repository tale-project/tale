import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  listMyNotifications,
  markNotificationRead,
  myUnreadCount,
  notifyAgentQuestionAsked,
} from './service.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkAgentQuestionCoalescing(
  sql: Sql,
  baseUrl: string,
  ctx: { orgId: string; userId: string; cookie: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId, cookie } = ctx;
  const suffix = randomUUID();
  const projectId = `question-project-${suffix}`;
  const taskId = `question-task-${suffix}`;
  const otherOrgId = `question-org-${suffix}`;
  const developer = `question-dev-${suffix}`;
  const runId = `question-run-${suffix}`;
  const askIds: string[] = [];
  const bell = async (recipient = userId, organizationId = orgId) =>
    (
      await listMyNotifications(sql, {
        organizationId,
        userId: recipient,
        limit: 100,
      })
    ).rows.filter((row) => askIds.includes(String(row.params?.askId)));
  const write = (args: Parameters<typeof notifyAgentQuestionAsked>[1]) =>
    transactSerializable(sql, (tx) => notifyAgentQuestionAsked(tx, args));

  try {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      VALUES (${developer}, 'Question recipient', ${`${developer}@example.com`},
              true, ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (${`member-${developer}`}, ${orgId}, ${developer}, 'developer', ${new Date()})
    `;
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${otherOrgId}, 'Question isolation', ${otherOrgId}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (${`other-member-${suffix}`}, ${otherOrgId}, ${userId}, 'owner', ${new Date()})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Question coalescing', ${userId}, ${Date.now()}, ${Date.now()})
    `;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
                             created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'Question control', 'todo',
              ${suffix}, ${userId}, 'user', ${Date.now()}, ${Date.now()})
    `;

    for (const scope of ['project', 'organization', 'task'] as const) {
      const askId = `question-${scope}-${suffix}`;
      askIds.push(askId);
      const args = {
        organizationId: orgId,
        askId,
        runId,
        question: 'Which account applies?',
        automationLabel: 'synthetic/question-coalescing',
        task:
          scope === 'task'
            ? { id: taskId, title: 'Question control', projectId }
            : null,
        ...(scope !== 'organization' ? { projectId } : {}),
      };
      const before = await myUnreadCount(sql, orgId, userId);
      await write(args);
      const created = (await bell()).find((row) => row.params?.askId === askId);
      await write({
        ...args,
        question: 'Which account applies? Also confirm the currency.',
      });
      const folded = (await bell()).filter(
        (row) => row.params?.askId === askId,
      );
      const unread = await myUnreadCount(sql, orgId, userId);
      record(
        `agent questions: ${scope} fold rewrites one unread card and counts one pending ask`,
        folded.length === 1 &&
          folded[0]?.id === created?.id &&
          folded[0]?.params?.question ===
            'Which account applies? Also confirm the currency.' &&
          unread === before + 1,
        `created=${created?.id} folded=${JSON.stringify(folded)} unread=${unread} baseline=${before}`,
      );

      if (scope === 'project') {
        const developerRows = (await bell(developer)).filter(
          (row) => row.params?.askId === askId,
        );
        record(
          'agent questions: a fold keeps independent recipient rows',
          developerRows.length === 1 &&
            developerRows[0]?.id !== created?.id &&
            developerRows[0]?.params?.question === folded[0]?.params?.question,
          JSON.stringify(developerRows),
        );
        const response = await fetch(
          `${baseUrl}/api/app/collab/notifications?orgId=${orgId}&unread=true&limit=100`,
          { headers: { cookie } },
        );
        const payload = z
          .object({
            rows: z.array(
              z.object({
                id: z.string(),
                params: z.record(z.string(), z.unknown()).nullable(),
              }),
            ),
          })
          .parse(await response.json());
        const apiRows = payload.rows.filter(
          (row) => row.params?.askId === askId,
        );
        const countResponse = await fetch(
          `${baseUrl}/api/app/collab/notifications/unread-count?orgId=${orgId}`,
          { headers: { cookie } },
        );
        const count = z
          .object({ count: z.number() })
          .parse(await countResponse.json());
        record(
          'agent questions: the authenticated bell API reads one folded card and the correct badge',
          response.status === 200 &&
            countResponse.status === 200 &&
            apiRows.length === 1 &&
            apiRows[0]?.id === created?.id &&
            count.count === before + 1,
          `status=${response.status}/${countResponse.status} rows=${JSON.stringify(apiRows)} count=${count.count}`,
        );
        await write({
          ...args,
          organizationId: otherOrgId,
          projectId: undefined,
          question: 'Other organization question',
        });
        const otherRows = (await bell(userId, otherOrgId)).filter(
          (row) => row.params?.askId === askId,
        );
        record(
          'agent questions: the same ask identity cannot rewrite another organization',
          otherRows.length === 1 &&
            otherRows[0]?.id !== created?.id &&
            (await bell()).find((row) => row.id === created?.id)?.params
              ?.question === folded[0]?.params?.question,
          JSON.stringify(otherRows),
        );
      }

      const separateAskId = `${askId}-separate`;
      askIds.push(separateAskId);
      if (scope !== 'task') {
        await write({
          ...args,
          askId: separateAskId,
          question: 'Separate pending ask in the same run',
        });
        const separate = (await bell()).filter(
          (row) =>
            row.params?.askId === askId || row.params?.askId === separateAskId,
        );
        record(
          `agent questions: ${scope} keeps distinct pending asks in the same run`,
          separate.length === 2 &&
            (await myUnreadCount(sql, orgId, userId)) === before + 2,
          JSON.stringify(separate),
        );
      }
      if (created) {
        await markNotificationRead(sql, {
          organizationId: orgId,
          userId,
          notificationId: created.id,
        });
        await write({
          ...args,
          question: 'A follow-up after the card was read',
        });
        const history = (await bell()).filter(
          (row) => row.params?.askId === askId,
        );
        record(
          `agent questions: ${scope} leaves read history untouched and creates a new unread card`,
          history.length === 2 &&
            history.find((row) => row.id === created.id)?.read === true &&
            history.find((row) => row.id === created.id)?.params?.question ===
              folded[0]?.params?.question &&
            history.filter((row) => !row.read).length === 1,
          JSON.stringify(history),
        );
      }
    }
  } finally {
    await sql`DELETE FROM app.user_notifications WHERE params->>'askId' IN ${sql(askIds)}`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    await sql`DELETE FROM "member" WHERE "id" IN ${sql([`member-${developer}`, `other-member-${suffix}`])}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${otherOrgId}`;
    await sql`DELETE FROM "user" WHERE "id" = ${developer}`;
  }
}
