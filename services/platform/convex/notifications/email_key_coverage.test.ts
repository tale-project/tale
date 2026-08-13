/**
 * Coverage gate: every i18n key an ACTIONABLE notification path can emit MUST be
 * mirrored in `INBOX_I18N`, or its email renders the raw key — the email/Slack
 * sink has no next-intl runtime (see notification_messages.ts).
 *
 * The `notification_messages` parity suite proves INBOX_I18N matches the message
 * bundle for the keys it LISTS; this suite proves the LIST is complete by walking
 * the two emitter surfaces:
 *   1. builtin automations (`notify_users` steps) — scanned dynamically, so a new
 *      automation that emails an unmirrored key fails CI without a test edit.
 *   2. the code emitters (`collab/notify*.ts`) — pinned as an explicit list, since
 *      their keys are chosen in TypeScript, not scannable config.
 *
 * Regression guard for the raw-key emails fixed alongside: conversationTeamAssigned*,
 * taskReviewReminder*, taskReviewEscalated*, humanInputEscalated*, taskSlaEscalated*.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACTIONABLE_NOTIFICATION_TYPES } from '../../lib/shared/attention';
import {
  INBOX_I18N,
  renderInboxMessage,
  SUPPORTED_NOTIFICATION_LOCALES,
} from './notification_messages';

const ACTIONABLE = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);

const AUTOMATIONS_DIR = fileURLToPath(
  new URL('../../../../builtin-configs/automations/', import.meta.url),
);

/**
 * Every `*.json` under builtin-configs/automations, recursively. The whole
 * `builtin-configs/` tree is retired while the automation backend is
 * rewritten, so a missing directory means "no
 * automations exist right now" — treat it as zero results rather than letting
 * `readdirSync` throw.
 */
function automationJsonPaths(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...automationJsonPaths(full));
    } else if (entry.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

interface EmittedKey {
  source: string;
  type: string;
  titleKey: string;
  bodyKey: string;
}

/** Recursively collect `notify_users` parameter blocks from a parsed manifest. */
function collectNotifyUsers(
  node: unknown,
  source: string,
  into: EmittedKey[],
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectNotifyUsers(child, source, into);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (
    obj.operation === 'notify_users' &&
    typeof obj.type === 'string' &&
    typeof obj.titleKey === 'string' &&
    typeof obj.bodyKey === 'string'
  ) {
    into.push({
      source,
      type: obj.type,
      titleKey: obj.titleKey,
      bodyKey: obj.bodyKey,
    });
  }
  for (const value of Object.values(obj)) {
    collectNotifyUsers(value, source, into);
  }
}

function actionableAutomationKeys(): EmittedKey[] {
  const found: EmittedKey[] = [];
  for (const path of automationJsonPaths(AUTOMATIONS_DIR)) {
    const manifest: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    collectNotifyUsers(manifest, path.slice(AUTOMATIONS_DIR.length), found);
  }
  return found.filter((k) => ACTIONABLE.has(k.type));
}

/**
 * Keys the TypeScript emitters pass for actionable types. Kept explicit — their
 * values are chosen in code, not scannable config. Adding an actionable
 * titleKey/bodyKey to collab/notify*.ts means adding it here.
 *   - collab/notify.ts: task_assigned, mention, conversation_assigned (+ team)
 *   - collab/notify_task_reviews.ts: task_review_requested (task_review_resolved
 *     is NOT actionable, so its keys are intentionally excluded)
 */
const CODE_EMITTED_KEYS: readonly string[] = [
  'taskAssigned',
  'taskAssignedBody',
  'taskAssignedByBody',
  'mention',
  'mentionBody',
  'mentionByBody',
  'conversationAssigned',
  'conversationAssignedBody',
  'conversationAssignedByBody',
  'conversationTeamAssigned',
  'conversationTeamAssignedBody',
  'conversationTeamAssignedByBody',
  'taskReviewRequested',
  'taskReviewRequestedBody',
  'taskReviewRequestedBodyNoAgent',
  'taskReviewRequestedByBody',
  'taskReviewRequestedBodyHuman',
  // tasks/enforce_date_notifications.ts
  'taskDueSoon',
  'taskDueSoonBody',
  'taskStartReached',
  'taskStartReachedBody',
  'taskSlaEscalated',
  'taskSlaEscalatedBody',
];

describe('actionable email key coverage', () => {
  it('mirrors every key emitted by builtin automations for actionable types (catalog offline during the AI-backend rewrite)', () => {
    // builtin-configs/ is retired while the automation backend is
    // rewritten, so there is nothing live under AUTOMATIONS_DIR to scan right
    // now — the walk is legitimately empty, not a silent regression. This
    // still proves the invariant for whatever it finds: once a rebuilt
    // catalog lands, every notify_users key it emits for an actionable type
    // must be mirrored in INBOX_I18N.
    const emitted = actionableAutomationKeys();
    const unmirrored = emitted.flatMap((k) =>
      [k.titleKey, k.bodyKey]
        .filter((key) => INBOX_I18N.en[key] === undefined)
        .map((key) => `${k.source} [${k.type}] → ${key}`),
    );
    expect(unmirrored).toEqual([]);

    // The escalation-only keys the retired automations used to emit
    // (taskSlaEscalated/taskDueSoon/taskStartReached via
    // enforce_date_notifications, humanInputEscalated/taskReviewReminder
    // via remind-reviewers) stay mirrored here even with nothing live to emit
    // them, so a rebuilt catalog can reuse them immediately.
    expect(INBOX_I18N.en.taskSlaEscalated).toBeDefined();
    expect(INBOX_I18N.en.taskDueSoon).toBeDefined();
    expect(INBOX_I18N.en.taskStartReached).toBeDefined();
    expect(INBOX_I18N.en.humanInputEscalated).toBeDefined();
    expect(INBOX_I18N.en.taskReviewReminder).toBeDefined();
  });

  it('mirrors every key emitted by the code notification paths', () => {
    const unmirrored = CODE_EMITTED_KEYS.filter(
      (key) => INBOX_I18N.en[key] === undefined,
    );
    expect(unmirrored).toEqual([]);
  });

  it('renders a real string — never the raw key — in every locale', () => {
    const allKeys = new Set<string>([
      ...CODE_EMITTED_KEYS,
      ...actionableAutomationKeys().flatMap((k) => [k.titleKey, k.bodyKey]),
    ]);
    for (const locale of SUPPORTED_NOTIFICATION_LOCALES) {
      for (const key of allKeys) {
        expect(renderInboxMessage(locale, key)).not.toBe(key);
      }
    }
  });
});
