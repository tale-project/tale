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

/**
 * The chat composer's video-link chips. Every write to `app.video_link_jobs`
 * — the pipeline's status patches, the deferred-send claims, cancel and
 * retry, the watchdogs' flips and reaps — hints the uploader under this
 * entity, and the app keys both chip reads (a thread's jobs, the caller's
 * unbound rows) under it. Before the hint existed those reads had no
 * signal at all and polled their route every two seconds on every open
 * chat page, forever.
 */
export const VIDEO_LINK_HINT_ENTITY = 'video_link';

/**
 * An organization's AI-provider credentials — and everything derived from
 * them: the composer's model catalog is the set of models a credential can
 * serve, so it keys under this entity and a credential write reaches every
 * open composer within a hint round-trip (it used to refetch on every
 * mount instead, twice per chat page).
 */
export const PROVIDER_CREDENTIAL_HINT_ENTITY = 'provider_credential';
