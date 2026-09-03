/**
 * Maximum number of emails processed in one ingest batch, oldest-first (so the
 * root email that anchors threading lands first).
 *
 * This MUST be at least the connector sync `limit` ceiling (100). Each email is
 * its own `ctx.runMutation`, so this is not an argument-size bound — it bounds
 * one action's work. The danger it used to create: when a pass fetched more than
 * this (`limit` defaults to 25, up to 100), the surplus was dropped here while
 * the watermark still advanced over it, so that mail was never re-fetched —
 * permanent silent loss. Keeping the cap at the fetch ceiling means a page is
 * always fully ingested; the watermark advancing only over the ingested set (see
 * the sync's `ingestedTip`) closes the gap even if a future limit exceeds it.
 */
export const MAX_EMAILS_PER_BATCH = 100;

/**
 * Subject stored for mail that arrived without one.
 *
 * A real stored value, not a render-time fallback, so anything reading a
 * subject must treat it as "no subject" rather than as prose — indexing it
 * would put the placeholder into the search corpus.
 */
export const NO_SUBJECT = '(no subject)';
