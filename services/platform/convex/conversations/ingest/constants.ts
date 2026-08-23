/**
 * Maximum number of emails to process in a single conversation creation batch.
 * Keeps oldest-first to preserve the root email needed for threading.
 * Constrained by Convex action argument size limits (~1MB for ctx.runMutation args).
 */
export const MAX_EMAILS_PER_BATCH = 20;

/**
 * Subject stored for mail that arrived without one.
 *
 * A real stored value, not a render-time fallback, so anything reading a
 * subject must treat it as "no subject" rather than as prose — indexing it
 * would put the placeholder into the search corpus.
 */
export const NO_SUBJECT = '(no subject)';
