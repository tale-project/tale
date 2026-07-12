/**
 * Shared column widths for the two webhook tables — agent webhooks
 * (`agent-webhook-section.tsx`) and workflow webhooks (`webhooks-section.tsx`
 * in this directory). Both tables render the exact same `url` / `active` /
 * `lastTriggered` columns, so their sizes are locked here instead of copied
 * as literals in each file (#2568) — a future change to one automatically
 * keeps the other in sync instead of quietly drifting.
 *
 * `active` and `lastTriggered` only need to fit a `Switch` and a formatted
 * timestamp respectively; the budget reclaimed from both goes to `url` so
 * long webhook URLs stay readable. Each table's own `actions` column is
 * sized separately — it isn't shared because the two tables offer a
 * different number of row actions.
 */

/** Fits the `Switch` control (32px track) plus the "Active"/"Aktiv"/"Actif" header. */
export const WEBHOOK_ACTIVE_COLUMN_SIZE = 68;

/**
 * Fits a `formatDate(..., 'long')` timestamp (e.g. "September 4, 2026 8:30 PM").
 * Deliberately not `150` — `DataTable` treats a declared size of exactly 150
 * as TanStack's "unset" sentinel in some sizing branches (see
 * `app/components/ui/data-table/data-table.tsx`'s `utilityPx` /
 * `cellWidthStyle`), which would silently fall back to auto-flex sizing.
 */
export const WEBHOOK_LAST_TRIGGERED_COLUMN_SIZE = 148;

/** Budget reclaimed from `active` + `lastTriggered` goes here (#2568). */
export const WEBHOOK_URL_COLUMN_SIZE = 444;

/**
 * Truncation width for the URL cell's `<code>` element itself — grown by the
 * same amount as `WEBHOOK_URL_COLUMN_SIZE` (+44px) so the reclaimed column
 * budget actually makes the visible URL longer, not just the column's empty
 * margin.
 */
export const WEBHOOK_URL_TEXT_MAX_WIDTH = 344;
