// Shared session-id derivation. The external-agent action and the public
// progress query must agree on the deterministic per-thread session id, so it
// lives here rather than private to either caller.

/** Deterministic spawner session id for a thread (ID_ALPHABET_RE-safe). */
export function sessionIdForThread(threadId: string): string {
  return `thr-${threadId}`.slice(0, 64);
}
