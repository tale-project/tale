/**
 * Task-comment thread constants (pure data; safe to import from the V8
 * runtime). Task comments are chat threads with `kind: 'task_discussion'`
 * attached to a task; they reuse the chat message store and generation path.
 */

/** Category stamped on a task's comment thread at creation. */
export const DEFAULT_DISCUSSION_CATEGORY = 'general';
