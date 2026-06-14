// Shared session-id derivation. The external-agent action and the public
// progress query must agree on the deterministic per-thread session id, so it
// lives here rather than private to either caller.

/** Deterministic spawner session id for a thread (ID_ALPHABET_RE-safe). Kept
 * for the no-user fallback; the primary owner is the user (sessionIdForUser). */
export function sessionIdForThread(threadId: string): string {
  return `thr-${threadId}`.slice(0, 64);
}

/** 64-bit FNV-1a, hex — a tiny, sync, runtime-agnostic hash to fold a composite
 * key into the sandbox session-id length budget. Not cryptographic; only needs
 * deterministic uniqueness across (org, user) pairs. */
function fnv1a64Hex(input: string): string {
  // 64-bit FNV-1a via two 32-bit halves (no BigInt — keep it cheap + portable).
  let h1 = 0x811c9dc5; // low 32
  let h2 = 0xcbf29ce4; // high 32
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    // multiply 64-bit accumulator by the FNV prime (0x100000001b3) in halves
    const l1 = (h1 & 0xffff) * 0x1b3;
    const l2 = (h1 >>> 16) * 0x1b3;
    const h1n = (h2 * 0x1b3 + (h1 >>> 16) * 0x100 + (l2 >>> 16)) >>> 0;
    h1 = (l1 + ((l2 & 0xffff) << 16)) >>> 0;
    h2 = h1n >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h2) + hex(h1);
}

/** Deterministic spawner session id for a (org, user) — one persistent sandbox
 * per user PER ORGANIZATION (a user in two orgs gets two isolated sandboxes; an
 * org-A workspace must never be reachable from org B). ID_ALPHABET_RE-safe and
 * ≤64 chars: a readable user-id prefix + an org-scoped hash suffix so the same
 * user in different orgs maps to distinct session ids. */
export function sessionIdForUser(
  organizationId: string,
  userId: string,
): string {
  const suffix = fnv1a64Hex(`${organizationId}:${userId}`);
  return `usr-${userId.slice(0, 24)}-${suffix}`.slice(0, 64);
}

/** Composite owner key for a per-org-user sandbox — used as sandboxSessions
 * `ownerId` so the by_owner reuse + per-owner cap lookups are naturally scoped
 * to (org, user), not just user. */
export function userOwnerId(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}
