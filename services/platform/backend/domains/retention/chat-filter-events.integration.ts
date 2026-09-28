/**
 * Real Postgres proof of the `chatFilterEvents` retention category — the
 * guardrail verdicts in `app.chat_filter_events`, which nothing deleted
 * before it — on an organization of its own: an event older than the window
 * plus the grace goes, one inside either stays; an event raised in the chat
 * of a member on a custodian hold stays until the hold is released, and a
 * full batch of held events never starves the unheld ones behind it; once
 * released, a backlog larger than one batch drains in a single run.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { Sql } from 'postgres';

import { getConfigRoot } from '../../core/lib/file_io.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { BOUNDS_FILE } from './audit-trail.integration.ts';
import { applyRetentionBounds, runRetentionCleanup } from './service.ts';

const DAY_MS = 24 * 3_600_000;

/** One more held event than the sweep's batch. */
const HELD_EVENTS = 1_001;

const POLICY_FILE = [
  // A policy without a documents window is no policy to the sweep.
  'documentsEnabled: false',
  'documentsRetentionDays: 365',
  'chatFilterEventsEnabled: true',
  'chatFilterEventsRetentionDays: 30',
  'deletionGraceDays: 2',
].join('\n');

export async function checkChatFilterEventRetention(
  sql: Sql,
  ctx: { userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { userId } = ctx;
  const orgId = randomUUID();
  const tag = orgId.slice(0, 8);
  const orgSlug = `itest-retention-cfe-${tag}`;
  const heldUser = `itest-cfe-held-${tag}`;
  const now = Date.now();
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, 'Chat filter event retention', ${orgSlug}, now())
  `;
  const orgConfigDir = path.join(getConfigRoot('retention'), orgSlug);
  await mkdir(path.join(orgConfigDir, 'governance'), { recursive: true });
  await writeFile(
    path.join(orgConfigDir, 'governance', 'retention.yml'),
    BOUNDS_FILE,
  );
  await writeFile(
    path.join(orgConfigDir, 'governance', 'retention-policy.yml'),
    POLICY_FILE,
  );
  clearOrgConfigCaches();
  await applyRetentionBounds(sql, { organizationId: orgId, actorId: userId });

  // Two chats — the held member's and the caller's — and a thread id whose
  // chat is gone. Every event is keyed by its label in `sanitization_run_id`.
  const heldThread = await chatOwnedBy(sql, orgId, heldUser, now);
  const ownThread = await chatOwnedBy(sql, orgId, userId, now);
  const aged = now - 40 * DAY_MS; // past 30 days + 2 of grace
  const graced = now - 31 * DAY_MS; // past the window, inside the grace
  const event = (label: string, threadId: string, createdAtMs: number) => ({
    org_id: orgId,
    sanitization_run_id: label,
    thread_id: threadId,
    filter_name: 'pii',
    direction: 'input',
    kind: 'detected',
    created_at_ms: createdAtMs,
  });
  const held = Array.from({ length: HELD_EVENTS }, () =>
    event('held', heldThread, aged),
  );
  await sql`INSERT INTO app.chat_filter_events ${sql(held)}`;
  await sql`
    INSERT INTO app.chat_filter_events ${sql([
      event('aged-own', ownThread, aged),
      event('aged-orphan', `cfe-${tag}-gone`, aged),
      event('graced', ownThread, graced),
      event('fresh', ownThread, now),
    ])}
  `;

  const hold = await sql<{ id: string }[]>`
    INSERT INTO app.legal_holds (
      org_id, target_type, target_id, target_label, reason, placed_by,
      placed_at_ms
    ) VALUES (
      ${orgId}, 'userMembership', ${heldUser}, 'itest held custodian',
      'chat filter event retention probe', ${userId}, ${now}
    ) RETURNING id
  `;
  await runRetentionCleanup(sql);
  const whileHeld = await eventsLeft(sql, orgId);
  const heldRun = await destructionCounts(sql, orgId);
  record(
    'retention: aged chat filter events go, fresh and graced ones stay, a held member’s stay without starving the batch',
    isDeepStrictEqual(whileHeld, {
      fresh: 1,
      graced: 1,
      held: HELD_EVENTS,
    }) && isDeepStrictEqual(heldRun, [2]),
    `left=${JSON.stringify(whileHeld)} (want fresh 1, graced 1, held ${HELD_EVENTS}; no aged-own, no aged-orphan), destructionRows=${JSON.stringify(heldRun)} (want [2])`,
  );

  // Released, the held events age out like any other. The backlog is more
  // than one batch, and the sweep drains it in one run under one row; the
  // run after it finds nothing and writes none.
  await sql`
    UPDATE app.legal_holds SET released_at_ms = ${Date.now()}
    WHERE id = ${hold[0]?.id ?? ''}
  `;
  await runRetentionCleanup(sql);
  const drained = await eventsLeft(sql, orgId);
  await runRetentionCleanup(sql);
  const released = await eventsLeft(sql, orgId);
  const runs = await destructionCounts(sql, orgId);
  record(
    'retention: a released hold lets its chat filter events age out, a backlog past one batch in a single run, the fresh and graced ones still kept',
    isDeepStrictEqual(drained, { fresh: 1, graced: 1 }) &&
      isDeepStrictEqual(released, { fresh: 1, graced: 1 }) &&
      isDeepStrictEqual(runs, [2, HELD_EVENTS]),
    `afterOneRun=${JSON.stringify(drained)}, afterTwo=${JSON.stringify(released)} (want fresh 1, graced 1 both times), destructionRows=${JSON.stringify(runs)} (want [2, ${HELD_EVENTS}])`,
  );

  // Later lanes sweep the fleet; this organization leaves it.
  await sql`DELETE FROM app.retention_applied_bounds WHERE org_id = ${orgId}`;
  await sql`DELETE FROM app.chat_filter_events WHERE org_id = ${orgId}`;
  await sql`DELETE FROM app.threads WHERE org_id = ${orgId}`;
  await rm(orgConfigDir, { recursive: true, force: true });
}

/** A chat thread, touched now so no chat-history window could reach it. */
async function chatOwnedBy(
  sql: Sql,
  orgId: string,
  ownerId: string,
  now: number,
): Promise<string> {
  const thread = await sql<{ id: string }[]>`
    INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                             updated_at_ms)
    VALUES (${orgId}, ${ownerId}, 'cfe-chat', 'chat', ${now}, ${now})
    RETURNING id
  `;
  const threadId = thread[0]?.id ?? '';
  await sql`
    INSERT INTO app.thread_metadata (
      thread_id, org_id, user_id, chat_type, status, created_at_ms
    ) VALUES (${threadId}, ${orgId}, ${ownerId}, 'chat', 'active', ${now})
  `;
  return threadId;
}

/** The org's surviving events, counted by label. */
async function eventsLeft(
  sql: Sql,
  orgId: string,
): Promise<Record<string, number>> {
  const rows = await sql<{ label: string; count: number }[]>`
    SELECT sanitization_run_id AS label, count(*)::int AS count
    FROM app.chat_filter_events
    WHERE org_id = ${orgId}
    GROUP BY sanitization_run_id
    ORDER BY sanitization_run_id
  `;
  return Object.fromEntries(rows.map((row) => [row.label, row.count]));
}

/** Each run's destruction row for the category, oldest first: its count. */
async function destructionCounts(sql: Sql, orgId: string): Promise<number[]> {
  const rows = await sql<{ deleted: number }[]>`
    SELECT (metadata->>'deleted')::int AS deleted
    FROM app.audit_logs
    WHERE org_id = ${orgId}
      AND action = 'chat_filter_event.retention_deleted'
    ORDER BY ts ASC, id ASC
  `;
  return rows.map((row) => row.deleted);
}
