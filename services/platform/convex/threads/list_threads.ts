// Minimal restore of the retired `threads/list_threads.ts` — the chat
// pipeline (`convex/threads/` in full, incl. this file's `listThreads` query
// and its
// `excludeDiscussionThreads`/`excludeNonChatHistoryThreads`/`isGeneralThread`
// siblings) is retired wholesale. `projects/queries.ts` is the only
// live importer, and only for `isHiddenFromChatHistory` — a pure, zero-
// dependency predicate over a thread's `kind`/`isBranch` fields, unrelated to
// the AI backend — so it's restored faithfully rather than stubbed. The rest
// of the module stays retired until the chat rewrite needs it again.

/**
 * `threadMetadata.kind` values that are NOT part of the user-facing chat
 * history. Project/task discussions reuse `chatType: 'general'` but live under
 * Projects, so they must be excluded from the chat sidebar, archive list,
 * command palette, "my chats" count, and bulk sweeps.
 */
const NON_CHAT_HISTORY_KINDS = [
  'project_discussion',
  'task_discussion',
  'automation_discussion',
] as const;

/**
 * True when a thread metadata row is hidden from the user-facing chat history:
 * a fork branch or a discussion. JS-side counterpart of
 * `excludeNonChatHistoryThreads` for callers that `.collect()` then filter in
 * memory.
 */
export function isHiddenFromChatHistory(row: {
  isBranch?: boolean;
  kind?: string;
}): boolean {
  if (row.isBranch === true) return true;
  // Widen the literal tuple to readonly string[] so an arbitrary `kind` string
  // can be tested without narrowing it to one of the literals.
  return (NON_CHAT_HISTORY_KINDS as readonly string[]).includes(row.kind ?? '');
}
