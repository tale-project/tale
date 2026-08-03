/**
 * Maximum number of emails to process in a single conversation creation batch.
 * Keeps oldest-first to preserve the root email needed for threading.
 * Constrained by Convex action argument size limits (~1MB for ctx.runMutation args).
 */
export const MAX_EMAILS_PER_BATCH = 20;
