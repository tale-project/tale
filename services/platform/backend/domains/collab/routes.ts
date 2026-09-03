import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  getProjectAuthContext,
  loadProjectOrThrow,
  ProjectError,
} from '../projects/service.ts';
import {
  assertTaskReadable,
  loadTaskOrThrow,
  TaskError,
} from '../tasks/service.ts';
import {
  getNotificationPreferences,
  getTaskSubscription,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  myUnreadCount,
  setNotificationPreferences,
  setTaskSubscription,
  getMyAttentionSummary,
} from './service.ts';

/** /api/app/collab — the bell (per-user content notifications), task
 * subscriptions, and notification preferences. */
export function createCollabRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/notifications', async (c) => {
    const cursorRaw = c.req.query('cursor');
    const limitRaw = c.req.query('limit');
    return c.json(
      await listMyNotifications(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        ...(cursorRaw !== undefined ? { cursor: Number(cursorRaw) } : {}),
        ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
        ...(c.req.query('unread') === 'true' ? { unreadOnly: true } : {}),
      }),
    );
  });

  app.get('/notifications/unread-count', async (c) => {
    return c.json({
      count: await myUnreadCount(
        deps.sql,
        c.get('orgId'),
        c.get('sessionBundle').user.id,
      ),
    });
  });

  app.post('/notifications/:notificationId/read', async (c) => {
    return c.json({
      ok: await markNotificationRead(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        notificationId: c.req.param('notificationId'),
      }),
    });
  });

  app.post('/notifications/read-all', async (c) => {
    return c.json({
      marked: await markAllNotificationsRead(
        deps.sql,
        c.get('orgId'),
        c.get('sessionBundle').user.id,
      ),
    });
  });

  /** The return loop: what needs this person back (the 0.4
   * `getMyAttentionSummary`). Optional `projectId` scopes it to one board. */
  app.get('/attention', async (c) => {
    const projectId = c.req.query('projectId');
    return c.json(
      await getMyAttentionSummary(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        ...(projectId !== undefined && projectId !== '' ? { projectId } : {}),
      }),
    );
  });

  app.get('/preferences', async (c) => {
    return c.json(
      await getNotificationPreferences(
        deps.sql,
        c.get('orgId'),
        c.get('sessionBundle').user.id,
      ),
    );
  });

  app.post('/preferences', async (c) => {
    const body = z
      .object({
        taskAssigned: z.boolean().optional(),
        taskStatusChanged: z.boolean().optional(),
        taskCommented: z.boolean().optional(),
        mention: z.boolean().optional(),
        taskDeadlines: z.boolean().optional(),
        taskReview: z.boolean().optional(),
        escalation: z.boolean().optional(),
        automationAlerts: z.boolean().optional(),
        conversationMessages: z.boolean().optional(),
        actionableEmail: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await setNotificationPreferences(
      deps.sql,
      c.get('orgId'),
      c.get('sessionBundle').user.id,
      body.data,
    );
    return c.json({ ok: true });
  });

  /** Subscriptions follow the task's own visibility: the task must exist in
   * THIS org and the caller must pass its project's read gate — a foreign or
   * invisible task id answers 404, exactly like the task surface itself. */
  const assertSubscribableTask = async (
    c: Context<OrgEnv>,
    taskId: string,
  ): Promise<void> => {
    const auth = await getProjectAuthContext(deps.sql, {
      organizationId: c.get('orgId'),
      userId: c.get('sessionBundle').user.id,
      role: c.get('orgMember').role,
    });
    const task = await loadTaskOrThrow(deps.sql, taskId, auth.organizationId);
    const project = await loadProjectOrThrow(deps.sql, task.projectId);
    assertTaskReadable(project, auth);
  };

  const subscriptionError = (c: Context<OrgEnv>, error: unknown): Response => {
    if (error instanceof TaskError || error instanceof ProjectError) {
      return c.json({ error: error.code }, error.status);
    }
    throw error;
  };

  app.get('/tasks/:taskId/subscription', async (c) => {
    try {
      await assertSubscribableTask(c, c.req.param('taskId'));
    } catch (error) {
      return subscriptionError(c, error);
    }
    return c.json(
      await getTaskSubscription(deps.sql, {
        taskId: c.req.param('taskId'),
        userId: c.get('sessionBundle').user.id,
      }),
    );
  });

  app.post('/tasks/:taskId/subscription', async (c) => {
    const body = z
      .object({
        subscribed: z.boolean().optional(),
        muted: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await assertSubscribableTask(c, c.req.param('taskId'));
    } catch (error) {
      return subscriptionError(c, error);
    }
    await setTaskSubscription(deps.sql, {
      organizationId: c.get('orgId'),
      taskId: c.req.param('taskId'),
      userId: c.get('sessionBundle').user.id,
      ...(body.data.subscribed !== undefined
        ? { subscribed: body.data.subscribed }
        : {}),
      ...(body.data.muted !== undefined ? { muted: body.data.muted } : {}),
    });
    return c.json({ ok: true });
  });

  return app;
}
