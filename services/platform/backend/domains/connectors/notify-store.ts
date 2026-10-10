import type { Sql } from 'postgres';

import {
  NOTIFY_RUN_CAP,
  RUN_STARTER,
  type NotifiedMember,
  type SkippedRecipient,
  type WorkflowNotifyStore,
} from '../../../lib/connectors/natives/platform-notify.ts';
import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import { notifyAutomationMessage } from '../collab/service.ts';

/**
 * The `notify.member` store: who a step's recipients are, and the message
 * written to each one's bell through the collaboration domain's own writer
 * (`notifyAutomationMessage`), which owns the preference, the run's cap and
 * the retry.
 *
 * A recipient is a member of the organization by email (any case) or user
 * id — not one whose membership is disabled, and not an API key's own
 * identity (its `.invalid` address names no person). `run-starter` is the
 * person who started the run; a run a trigger started, or whose starter is
 * gone, has none, and the message lists it as skipped. Any other recipient
 * who is not a member refuses the whole message before anything is sent.
 */
export function pgNotifyStore(sql: Sql): WorkflowNotifyStore {
  return {
    notify: (args) =>
      sql.begin(async (tx) => {
        const runs = await tx<{ name: string; startedBy: string }[]>`
          SELECT name, started_by AS "startedBy" FROM app.automation_runs
          WHERE org_id = ${args.organizationId} AND id = ${args.runId}
          LIMIT 1
        `;
        const run = runs[0];
        if (run === undefined) {
          return { ok: false as const, refusal: { kind: 'no_run' as const } };
        }
        const starterId = args.to.includes(RUN_STARTER)
          ? runStarterUserId(run.startedBy)
          : null;
        const named = args.to.filter((to) => to !== RUN_STARTER);
        const emails = named
          .filter((to) => to.includes('@'))
          .map((to) => to.toLowerCase());
        const ids = [
          ...named.filter((to) => !to.includes('@')),
          ...(starterId === null ? [] : [starterId]),
        ];
        const members =
          emails.length + ids.length === 0
            ? []
            : await tx<{ id: string; email: string | null }[]>`
                SELECT u.id, lower(u.email) AS email
                FROM "member" m JOIN "user" u ON u.id = m."userId"
                WHERE m."organizationId" = ${args.organizationId}
                  AND lower(m."role") <> 'disabled'
                  AND (u.email IS NULL OR lower(u.email) NOT LIKE '%.invalid')
                  AND (u.id = ANY(${ids}) OR lower(u.email) = ANY(${emails}))
              `;
        const memberIds = new Set(members.map((member) => member.id));
        const byEmail = new Map(
          members.map((member) => [member.email, member.id]),
        );
        const userIdOf = (to: string): string | undefined => {
          if (to === RUN_STARTER) {
            return starterId !== null && memberIds.has(starterId)
              ? starterId
              : undefined;
          }
          if (to.includes('@')) return byEmail.get(to.toLowerCase());
          return memberIds.has(to) ? to : undefined;
        };

        const unknown = named.filter((to) => userIdOf(to) === undefined);
        if (unknown.length > 0) {
          return {
            ok: false as const,
            refusal: { kind: 'not_a_member' as const, recipients: unknown },
          };
        }
        // Each person once, under the first name the step gave them.
        const recipients = new Map<string, string>();
        for (const to of args.to) {
          const userId = userIdOf(to);
          if (userId !== undefined && !recipients.has(userId)) {
            recipients.set(userId, to);
          }
        }
        const outcome = await notifyAutomationMessage(tx, {
          organizationId: args.organizationId,
          runId: args.runId,
          deliveryKey: args.idempotencyKey,
          userIds: [...recipients.keys()],
          automation: run.name,
          title: args.title,
          ...(args.message !== undefined && { message: args.message }),
          ...(args.link !== undefined && { link: args.link }),
          runCap: NOTIFY_RUN_CAP,
        });
        if (!outcome.ok) {
          return {
            ok: false as const,
            refusal: {
              kind: 'run_limit' as const,
              limit: NOTIFY_RUN_CAP,
              sent: outcome.sent,
            },
          };
        }
        const delivered: NotifiedMember[] = outcome.delivered.map((userId) => ({
          to: recipients.get(userId) ?? userId,
          userId,
        }));
        const skipped: SkippedRecipient[] = [
          ...outcome.muted.map((userId) => ({
            to: recipients.get(userId) ?? userId,
            userId,
            reason: 'preference' as const,
          })),
          ...(args.to.includes(RUN_STARTER) &&
          userIdOf(RUN_STARTER) === undefined
            ? [{ to: RUN_STARTER, reason: 'no_starter' as const }]
            : []),
        ];
        return { ok: true as const, delivered, skipped };
      }),
  };
}
