import type { Sql } from 'postgres';

import { defaultLocale as appDefaultLocale } from '../../../lib/i18n/config.ts';
import { clampToSupportedLocale } from '../../../lib/shared/utils/get-organization-default-locale.ts';
import { sendConnectorAction } from '../../core/conversations/connector_slug.ts';
import { ACTIONABLE_EMAIL_CONNECTORS } from '../../core/notifications/actionable_email_connectors.ts';
import {
  buildActionableEmailInput,
  pickSendableMailbox,
} from '../../core/notifications/actionable_email_input.ts';
import { renderActionableEmailContent } from '../../core/notifications/notification_messages.ts';
import { buildPersonalNotificationUrl } from '../../core/notifications/personal_notification_url.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import { runConnectorAction } from '../connectors/service.ts';

/**
 * The debounced actionable-email sink — the 0.4
 * `deliverActionableEmailAction` twin. Best-effort by contract: every skip
 * is silent (the in-app bell row is the durable record) and a failed send
 * only logs. "Send the latest version, once" is enforced HERE, by
 * re-reading the row: a rewritten row's epoch outran the payload's (its own
 * newer job carries the final state), an undone row is gone, and a read row
 * needs no email.
 */

async function organizationDefaultLocale(
  sql: Sql,
  organizationId: string,
): Promise<string> {
  const rows = await sql<{ metadata: unknown }[]>`
    SELECT "metadata" FROM "organization" WHERE "id" = ${organizationId}
    LIMIT 1
  `;
  let metadata = rows[0]?.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return appDefaultLocale;
    }
  }
  if (metadata === null || typeof metadata !== 'object') {
    return appDefaultLocale;
  }
  return clampToSupportedLocale(Reflect.get(metadata, 'defaultLocale'));
}

export async function runNotificationEmailJob(
  sql: Sql,
  payload: TaskPayloads['notification.email'],
): Promise<void> {
  const rows = await sql<
    {
      userId: string;
      organizationId: string;
      type: string;
      titleKey: string;
      bodyKey: string;
      params: Record<string, unknown> | null;
      taskId: string | null;
      read: boolean;
      emailEpoch: number;
    }[]
  >`
    SELECT user_id AS "userId", org_id AS "organizationId", type,
           title_key AS "titleKey", body_key AS "bodyKey", params,
           task_id AS "taskId", read, email_epoch::float8 AS "emailEpoch"
    FROM app.user_notifications
    WHERE id = ${payload.notificationId} LIMIT 1
  `;
  const notification = rows[0];
  // Gone (undone), already seen in the app, or rewritten since (the newer
  // job carries the final state) — no email.
  if (
    !notification ||
    notification.read ||
    notification.emailEpoch !== payload.epoch
  ) {
    return;
  }

  const users = await sql<{ email: string | null }[]>`
    SELECT "email" FROM "user" WHERE "id" = ${notification.userId} LIMIT 1
  `;
  const recipientEmail = users[0]?.email?.trim();
  if (!recipientEmail) return;

  // Tri-state preference: no row / null → default ON.
  const prefs = await sql<{ actionableEmail: boolean | null }[]>`
    SELECT actionable_email AS "actionableEmail"
    FROM app.notification_preferences
    WHERE user_id = ${notification.userId}
      AND org_id = ${notification.organizationId}
    LIMIT 1
  `;
  if (prefs[0]?.actionableEmail === false) return;

  const credentials = await sql<
    { credentialId: string; connectorSlug: string; isDefault: boolean }[]
  >`
    SELECT id AS "credentialId", connector_slug AS "connectorSlug",
           is_default AS "isDefault"
    FROM app.connector_credentials
    WHERE org_id = ${notification.organizationId} AND status = 'active'
      AND connector_slug IN ${sql([...ACTIONABLE_EMAIL_CONNECTORS])}
  `;
  const mailbox = pickSendableMailbox(credentials);
  if (!mailbox) return;

  const locale = await organizationDefaultLocale(
    sql,
    notification.organizationId,
  );
  const params = notification.params ?? {};
  const deepLink = buildPersonalNotificationUrl({
    organizationId: notification.organizationId,
    ...(notification.taskId !== null ? { taskId: notification.taskId } : {}),
    params,
  });
  const { subject, text, html } = renderActionableEmailContent(locale, {
    titleKey: notification.titleKey,
    bodyKey: notification.bodyKey,
    params,
    deepLink,
  });

  const { connector, action } = sendConnectorAction(mailbox.connectorSlug);
  try {
    const result = await runConnectorAction(sql, {
      organizationId: notification.organizationId,
      connector,
      action,
      input: buildActionableEmailInput(mailbox.connectorSlug, {
        to: recipientEmail,
        subject,
        text,
        html,
      }),
      credentialRef: mailbox.credentialId,
      mode: 'live',
      caller: { kind: 'system', reason: 'actionable notification email' },
    });
    if (result.status !== 'ok') {
      console.warn(
        `[notification-email] send refused for ${notification.type} → ${recipientEmail}: ${result.message}`,
      );
    }
  } catch (error) {
    console.warn(
      `[notification-email] send failed for ${notification.type} → ${recipientEmail}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
