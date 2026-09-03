/**
 * Realtime hint vocabulary shared by BOTH ends of the Tier-2 bus.
 *
 * The backend's outbox writers (the `emitHintInTx` callers under
 * `backend/domains/**`) name the entity a change touched; the web app keys its
 * queries `['backend', orgId, entity, …]` (`app/lib/backend/query-keys.ts`)
 * and invalidates by that prefix when the hint arrives. The two ends agree on
 * plain singular nouns (`task`, `document`, `member`, …) — and drift on one of
 * them is silence, not an error: the personal bell once emitted
 * `user_notification` while the app listened on `notification`, so mentions,
 * assignments and review requests never lit the bell live. A name both ends
 * must share is declared here and imported by both, so it cannot drift again.
 */

/**
 * Both bells — the per-user collab bell (`app.user_notifications`) and the
 * org-audience feed (`app.notifications`) — invalidate under ONE entity: the
 * app keys every unread count and every notification page under it.
 */
export const NOTIFICATION_HINT_ENTITY = 'notification';
