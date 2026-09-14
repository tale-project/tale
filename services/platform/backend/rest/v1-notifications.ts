import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  notificationTargetPath,
  orgNotificationTarget,
  personalNotificationTarget,
} from '../../lib/shared/notifications/target';
import { getOrganizationDefaultLocale } from '../../lib/shared/utils/get-organization-default-locale';
import { isAdminRole } from '../auth/membership';
import { mirrorMessage } from '../core/notifications/mirror_message';
import { orgNotificationLinkSchema } from '../core/notifications/org_notification_link';
import { listMyNotifications } from '../domains/collab/service';
import { listNotifications } from '../domains/notifications/service';
import {
  formatKeysetCursor,
  mintCursor,
  PAGE_QUERY,
  readIntegerCursor,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  type RestEnv,
} from './shared';

function sourceRow(
  args: {
    id: string;
    titleKey: string;
    bodyKey: string;
    params: Record<string, unknown> | null;
    createdAt: number;
    read: boolean;
  },
  prefix: string,
  namespace: 'inbox' | 'notifications',
  locale: string,
  path: string,
) {
  const row = {
    id: `${prefix}:${args.id}`,
    title: mirrorMessage(namespace, args.titleKey, args.params, locale).slice(
      0,
      500,
    ),
    body: mirrorMessage(namespace, args.bodyKey, args.params, locale).slice(
      0,
      8000,
    ),
    path,
    createdAt: args.createdAt,
    read: args.read,
  };
  return {
    ...row,
    version: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
  };
}

/** Read-only, organization-admin export of each verified member's own bell. */
export function createNotificationRestRoutes(deps: {
  sql: Sql;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();
  app.get('/notifications/sync', async (c) => {
    if (!isAdminRole(c.get('role')))
      return c.json(
        {
          error: 'Notification export requires an organization administrator.',
          code: 'ROLE_FORBIDDEN',
        },
        403,
      );
    const query = readQuery(c, {
      ...PAGE_QUERY,
      recipientEmail: z
        .email()
        .max(320)
        .transform((email) => email.trim().toLowerCase()),
      stream: z.enum(['personal', 'organization']),
      locale: z.enum(['en', 'de', 'fr']).optional(),
    });
    if (query instanceof Response) return query;
    const limit = readPageLimit(c, { fallback: 100, max: 100 });
    if (limit instanceof Response) return limit;
    // Membership and verification are checked on EVERY page. No lookup by
    // email can export a foreign, removed, disabled or unverified account.
    const members = await deps.sql<
      { id: string; role: string; metadata: unknown }[]
    >`
      SELECT u.id, lower(m.role) AS role, o.metadata FROM "user" u
      JOIN "member" m ON m."userId" = u.id
      JOIN "organization" o ON o.id = m."organizationId"
      WHERE m."organizationId" = ${c.get('organizationId')}
        AND lower(u.email) = ${query.recipientEmail}
        AND u."emailVerified" = true AND lower(m.role) <> 'disabled'
      LIMIT 2
    `;
    const recipient = members.length === 1 ? members[0] : undefined;
    const list = `notifications:${query.stream}:${query.recipientEmail}:${recipient?.id ?? 'absent'}`;
    const locale =
      query.locale ?? getOrganizationDefaultLocale(recipient?.metadata);
    const prefix = `${c.get('organizationId')}:${query.stream}`;
    if (query.stream === 'personal') {
      const cursor = readIntegerCursor(c, list);
      if (cursor instanceof Response) return cursor;
      if (!recipient)
        return c.json({
          recipientId: null,
          page: [],
          isDone: true,
          continueCursor: '',
        });
      const result = await listMyNotifications(deps.sql, {
        organizationId: c.get('organizationId'),
        userId: recipient.id,
        ...(cursor === null ? {} : { cursor }),
        limit,
      });
      return c.json({
        recipientId: recipient.id,
        page: result.rows.map((row) =>
          sourceRow(
            row,
            prefix,
            'inbox',
            locale,
            notificationTargetPath(
              personalNotificationTarget({
                organizationId: c.get('organizationId'),
                taskId: row.taskId ?? undefined,
                params: row.params,
              }),
            ),
          ),
        ),
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null
            ? ''
            : mintCursor(c, list, String(result.nextCursor)),
      });
    }
    const cursor = readKeysetCursor(c, list);
    if (cursor instanceof Response) return cursor;
    if (!recipient)
      return c.json({
        recipientId: null,
        page: [],
        isDone: true,
        continueCursor: '',
      });
    const result = await listNotifications(
      deps.sql,
      {
        orgId: c.get('organizationId'),
        userId: recipient.id,
        role: recipient.role,
      },
      {
        cursor: cursor ? { createdAt: cursor.at, id: cursor.id } : null,
        limit,
      },
    );
    return c.json({
      recipientId: recipient.id,
      page: result.items.map((row) => {
        const parsed = orgNotificationLinkSchema.safeParse(row.link);
        const link = parsed.success ? parsed.data : undefined;
        return sourceRow(
          row,
          prefix,
          'notifications',
          locale,
          notificationTargetPath(
            orgNotificationTarget(c.get('organizationId'), link, row.category),
          ),
        );
      }),
      isDone: result.nextCursor === null,
      continueCursor:
        result.nextCursor === null
          ? ''
          : mintCursor(
              c,
              list,
              formatKeysetCursor(
                result.nextCursor.createdAt,
                result.nextCursor.id,
              ),
            ),
    });
  });
  return app;
}
