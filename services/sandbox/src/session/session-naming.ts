// Deterministic session naming + runnerd token derivation.
//
// Both are pure functions of (sessionId [, SANDBOX_TOKEN]) so any spawner
// replica can address any session and authenticate to its runnerd WITHOUT
// shared state — the registry is a cache, the backend objects + these
// derivations are the source of truth (sessions plan §5).

import { createHmac } from 'node:crypto';

import { RUNNERD_TOKEN_CONTEXT } from './runnerd-protocol.ts';

/**
 * Docker container name / K8s annotation key for a session. The `ses-`
 * infix keeps session containers disjoint from one-shot `tale-sbx-<id>`
 * containers so the existing one-shot sweep (label `tale.sandbox=1`) never
 * touches them. sessionId is ID_ALPHABET_RE-validated upstream.
 */
export function sessionContainerName(sessionId: string): string {
  return `tale-sbx-ses-${sessionId}`;
}

/** Per-session workspace dir under the host session root (Docker backend).
 * The `ses-` prefix is also what the one-shot host-dir sweep skips. */
export function sessionWorkspaceDirName(sessionId: string): string {
  return `ses-${sessionId}`;
}

/**
 * Per-session runnerd token. HMAC-SHA256(SANDBOX_TOKEN, "runnerd-v1:" +
 * sessionId): derivable by any replica, stored nowhere, and one-way — a
 * compromised session learns only its own token, not the platform secret or
 * any peer's. SANDBOX_TOKEN is required (loadConfig fails closed), so every
 * session gets a real token — there is no unsigned mode.
 */
export function deriveRunnerdToken(
  sandboxToken: string,
  sessionId: string,
): string {
  return createHmac('sha256', sandboxToken)
    .update(`${RUNNERD_TOKEN_CONTEXT}${sessionId}`)
    .digest('hex');
}
