/**
 * The kind a call the platform makes straight to a provider files its op
 * under (`direct-calls.ts`) — an automation's `llm` step, a chat title, the
 * Inbox's Improve, a transcription, an embedding request. Like a
 * model-endpoint request it is no agent turn: its `session_id` is
 * `direct-call:<lane>`, which names no session row, and the row records
 * whose call it is, what it holds while a budget binds, and what it was
 * booked at.
 */
export const DIRECT_CALL_OP_KIND = 'direct-call';
