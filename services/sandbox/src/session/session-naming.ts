// Deterministic session naming + runnerd token derivation.
//
// Both are pure functions of (sessionId [, SANDBOX_TOKEN]) so any spawner
// replica can address any session and authenticate to its runnerd WITHOUT
// shared state — the registry is a cache, the backend objects + these
// derivations are the source of truth (sessions plan §5).

import { createHash, createHmac } from 'node:crypto';

import { RUNNERD_TOKEN_CONTEXT } from './runnerd-protocol.ts';

const SESSION_CONTAINER_PREFIX = 'tale-sbx-ses-';
/** The longest DNS label: the spawner reaches a session's runnerd at the
 * container's name on the sandbox network, and a longer name never
 * resolves. */
const DNS_LABEL_MAX = 63;

/**
 * Docker container name for a session — also the hostname the spawner
 * reaches the session's runnerd at, so it must stay a valid DNS label. The
 * `ses-` infix keeps session containers disjoint from one-shot `tale-sbx-<id>`
 * containers so the existing one-shot sweep (label `tale.sandbox=1`) never
 * touches them. sessionId is ID_ALPHABET_RE-validated upstream, up to 64
 * characters: an id whose name would outgrow a DNS label (a project agent's
 * workspace for a member's runs, `pa-<agent id>-m<hash>`, or a further worker
 * of one of its workspaces, `…-w<n>`) is folded into a hash, the way the
 * Kubernetes backend names its Pods.
 */
export function sessionContainerName(sessionId: string): string {
  const name = `${SESSION_CONTAINER_PREFIX}${sessionId}`;
  if (name.length <= DNS_LABEL_MAX) return name;
  const hash = createHash('sha1').update(sessionId).digest('hex').slice(0, 16);
  return `${SESSION_CONTAINER_PREFIX}${hash}`;
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
