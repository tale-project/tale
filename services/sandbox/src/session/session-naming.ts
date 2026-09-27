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

// Prefix of every per-session workspace dir under the host session root
// (Docker backend), in BOTH layouts the resolver knows — flat `<root>/ses-<id>`
// and legacy colour-rooted `<root>/<colour>/ses-<id>`. It is the one marker
// the host-dir sweep keys its "never delete" rule on.
const SESSION_WORKSPACE_DIR_PREFIX = 'ses-';

/** Per-session workspace dir under the host session root (Docker backend). */
export function sessionWorkspaceDirName(sessionId: string): string {
  return `${SESSION_WORKSPACE_DIR_PREFIX}${sessionId}`;
}

/** Is this dir name a session workspace (either layout)? Session workspaces
 * are lifecycle-managed by destroySession alone — the reaper only ever STOPS
 * a session and keeps its data — so nothing else may delete one. */
export function isSessionWorkspaceDirName(name: string): boolean {
  return name.startsWith(SESSION_WORKSPACE_DIR_PREFIX);
}

/**
 * Label naming the spawner instance a session belongs to. The deployment's
 * spawner has no instance (the label is absent); a connected device's
 * spawner runs as `device`. Every inventory a spawner acts on (re-adoption,
 * capacity) is scoped by it, so two spawners sharing one Docker daemon — a
 * developer's machine connected as a device while it also runs Tale — never
 * adopt, count or reap each other's sessions.
 */
export const SESSION_INSTANCE_LABEL = 'tale.sandbox-instance';

/** `docker ps` filter selecting an instance's sessions. Docker cannot filter
 * on a label's ABSENCE, so the default instance (empty) filters nothing here
 * and drops labelled rows itself ({@link belongsToInstance}). */
export function sessionInstanceFilter(instance: string): string[] {
  return instance === ''
    ? []
    : ['--filter', `label=${SESSION_INSTANCE_LABEL}=${instance}`];
}

/** Does a container whose instance label reads `label` belong to `instance`? */
export function belongsToInstance(
  label: string | null | undefined,
  instance: string,
): boolean {
  return (label ?? '') === instance;
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
