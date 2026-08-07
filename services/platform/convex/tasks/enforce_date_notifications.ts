/**
 * Platform cron that enforces task start/due date notifications.
 *
 * Replaces the retired `enforce-slas` task-ops pack: hourly mark-and-return
 * sweeps plus `notifyFromAutomation` fan-out. Org-paged so one slow org
 * cannot starve the rest.
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { resolveDateNotifyAudience } from './date_notification_recipients';

const DUE_SOON_WINDOW_HOURS = 24;
const MANAGER_ESCALATION_HOURS = 24;
const ADMIN_ESCALATION_HOURS = 72;
const SWEEP_LIMIT = 50;
const WORKFLOW_ACTOR_ID = 'workflow';

const OVERDUE_NUDGE_BODY =
  '[automated] This task is past its due date. Update the due date, reprioritize, or close it.';
const OVERDUE_NUDGE_BODY_BY_LOCALE = {
  en: OVERDUE_NUDGE_BODY,
  de: '[automatisiert] Diese Aufgabe ist überfällig. Aktualisiere das Fälligkeitsdatum, ändere die Priorität oder schließe sie.',
  fr: "[automatisé] Cette tâche a dépassé son échéance. Mets à jour l'échéance, change la priorité ou ferme-la.",
};

type SweepRow = {
  taskId: Id<'tasks'>;
  projectId: Id<'projects'>;
  title: string;
  assigneeType?: 'user' | 'agent' | 'app';
  assigneeId?: string;
  taskCreatorId?: string;
  projectCreatorId?: string;
};

async function notifyDateAlert(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    row: SweepRow;
    titleKey: string;
    bodyKey: string;
    type: 'task_status_changed' | 'agent_escalation';
  },
): Promise<void> {
  const audience = resolveDateNotifyAudience(args.row);
  if (audience === null) return;
  await ctx.runMutation(
    internal.collab.internal_mutations.notifyFromAutomation,
    {
      organizationId: args.organizationId,
      audience,
      type: args.type,
      titleKey: args.titleKey,
      bodyKey: args.bodyKey,
      params: { title: args.row.title },
      taskId: args.row.taskId,
      projectId: args.row.projectId,
    },
  );
}

async function enforceForOrg(
  ctx: ActionCtx,
  organizationId: string,
): Promise<{
  start: number;
  dueSoon: number;
  overdue: number;
}> {
  const starting = await ctx.runMutation(
    internal.tasks.internal_mutations.sweepStartingTasks,
    { organizationId, limit: SWEEP_LIMIT },
  );
  for (const row of starting) {
    await notifyDateAlert(ctx, {
      organizationId,
      row,
      titleKey: 'taskStartReached',
      bodyKey: 'taskStartReachedBody',
      type: 'task_status_changed',
    });
  }

  const dueSoon = await ctx.runMutation(
    internal.tasks.internal_mutations.sweepDueSoonTasks,
    {
      organizationId,
      windowHours: DUE_SOON_WINDOW_HOURS,
      limit: SWEEP_LIMIT,
    },
  );
  for (const row of dueSoon) {
    await notifyDateAlert(ctx, {
      organizationId,
      row,
      titleKey: 'taskDueSoon',
      bodyKey: 'taskDueSoonBody',
      type: 'task_status_changed',
    });
  }

  const overdue = await ctx.runMutation(
    internal.tasks.internal_mutations.sweepOverdueLadder,
    {
      organizationId,
      managerEscalationHours: MANAGER_ESCALATION_HOURS,
      adminEscalationHours: ADMIN_ESCALATION_HOURS,
      limit: SWEEP_LIMIT,
    },
  );
  for (const row of overdue) {
    if (row.newLevel === 2) {
      await ctx.runMutation(internal.tasks.internal_mutations.agentAddComment, {
        organizationId,
        actorId: WORKFLOW_ACTOR_ID,
        taskId: row.taskId,
        body: OVERDUE_NUDGE_BODY,
        bodyByLocale: OVERDUE_NUDGE_BODY_BY_LOCALE,
      });
      continue;
    }
    // Levels 3–4: escalate to human creator (when present) then org admins.
    if (row.taskCreatorId) {
      await ctx.runMutation(
        internal.collab.internal_mutations.notifyFromAutomation,
        {
          organizationId,
          audience: 'task_creator',
          type: 'agent_escalation',
          titleKey: 'taskSlaEscalated',
          bodyKey: 'taskSlaEscalatedBody',
          params: { title: row.title },
          taskId: row.taskId,
          projectId: row.projectId,
        },
      );
    } else if (row.projectCreatorId) {
      await ctx.runMutation(
        internal.collab.internal_mutations.notifyFromAutomation,
        {
          organizationId,
          audience: 'project_creator',
          type: 'agent_escalation',
          titleKey: 'taskSlaEscalated',
          bodyKey: 'taskSlaEscalatedBody',
          params: { title: row.title },
          taskId: row.taskId,
          projectId: row.projectId,
        },
      );
    }
    await ctx.runMutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId,
        audience: 'org_admins',
        type: 'agent_escalation',
        titleKey: 'taskSlaEscalated',
        bodyKey: 'taskSlaEscalatedBody',
        params: { title: row.title },
        taskId: row.taskId,
        projectId: row.projectId,
      },
    );
  }

  return {
    start: starting.length,
    dueSoon: dueSoon.length,
    overdue: overdue.length,
  };
}

/**
 * Hourly entry: page every Better Auth organization and run the date-
 * notification sweeps. Idempotent — sweeps stamp mark-and-return state.
 */
export const enforceTaskDateNotifications = internalAction({
  args: {},
  returns: v.object({
    orgs: v.number(),
    start: v.number(),
    dueSoon: v.number(),
    overdue: v.number(),
    failedOrgs: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    orgs: number;
    start: number;
    dueSoon: number;
    overdue: number;
    failedOrgs: number;
  }> => {
    const orgs: Array<{ id: string }> = [];
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    const MAX_PAGES = 1000;
    let pages = 0;
    while (!isDone) {
      if (pages++ >= MAX_PAGES) {
        throw new Error(
          `enforceTaskDateNotifications: pagination did not terminate within ${MAX_PAGES} pages`,
        );
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        throw new Error(
          'enforceTaskDateNotifications: pagination cursor did not advance',
        );
      }
      prevCursor = cursor;
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      if (!isRecord(res)) break;
      const page = Array.isArray(res.page) ? res.page : [];
      for (const row of page) {
        if (!isRecord(row)) continue;
        const id = getString(row, 'id');
        if (id) orgs.push({ id });
      }
      isDone = res.isDone === true;
      cursor =
        typeof res.continueCursor === 'string' ? res.continueCursor : null;
      if (isDone || cursor === null) break;
    }

    let start = 0;
    let dueSoon = 0;
    let overdue = 0;
    let failedOrgs = 0;
    for (const org of orgs) {
      try {
        const counts = await enforceForOrg(ctx, org.id);
        start += counts.start;
        dueSoon += counts.dueSoon;
        overdue += counts.overdue;
      } catch (error) {
        failedOrgs += 1;
        console.error('[enforceTaskDateNotifications] org failed', {
          organizationId: org.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      orgs: orgs.length,
      start,
      dueSoon,
      overdue,
      failedOrgs,
    };
  },
});
