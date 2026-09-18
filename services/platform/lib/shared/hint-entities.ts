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
 * A thread's parked sends — the "Queued — sends when the attachments are
 * ready" tray above the composer. Every write to `app.deferred_sends` (park,
 * claim, settle, re-park, cancel, the watchdog's clear) hints the sender
 * under this entity, and the app keys the tray read under it. The backend
 * settles the row the moment the fired turn persists the user message, but
 * before the hint existed nothing told the tab: the tray read had no signal
 * and no poll, so the row stayed on screen as "Queued" for the whole
 * generation, until the thread stream's settle nudged the read.
 */
export const DEFERRED_SEND_HINT_ENTITY = 'chat_deferred';

/**
 * An organization's AI-provider credentials — and everything derived from
 * them. What the credentials can serve is the answer behind the composer's
 * model catalog, the agent model pickers, the runtime status on the
 * providers page, the resolved vision model and the embedding
 * recommendations, so every one of those reads keys under this entity: a
 * credential write reaches each open one within a hint round-trip. A read
 * keyed anywhere else keeps its first answer until the page reloads — which
 * is how a newly added provider stayed invisible to the agent pickers.
 */
export const PROVIDER_CREDENTIAL_HINT_ENTITY = 'provider_credential';

/**
 * An organization's teams — the settings Teams table, the account menu's team
 * picker and every team-scoped count keyed under it. Team create, rename and
 * delete ride Better Auth's own organization endpoints rather than an app
 * route, so the app's write adapters never see them: the dialogs invalidate
 * their OWN tab by hand, and without the hooks in `auth.ts` emitting under
 * this entity nobody else in the organization learns anything — a second tab,
 * and every teammate with the page open, kept the stale list until reload.
 * Team MEMBERSHIP writes, which do ride app routes, hint under the same
 * entity so a membership change refreshes the same lists.
 */
export const TEAM_HINT_ENTITY = 'team';
