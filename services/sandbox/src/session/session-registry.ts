// In-memory session registry — a CACHE, not the source of truth.
//
// The authoritative state is the backend objects (container/Pod labels +
// annotations) plus runnerd's activity clock. This map is a hot-path cache so
// the route layer doesn't hit the backend on every exec; on a miss (a peer
// replica created the session, or this spawner missed it at boot) the route
// layer re-resolves from the backend by deterministic name
// (SessionRoutes.ensureRegistered) and the periodic sweep re-adopts whatever
// the backend lists. Per-exec AbortControllers live here too, keyed
// sessionId/execId, so cancel can find them.

import type { SandboxSessionProfile, SandboxSessionState } from '../wire.ts';

export interface RegistrySession {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  state: SandboxSessionState;
  createdAtMs: number;
  expiresAtMs: number;
  idleTimeoutMs: number;
  /** runnerd base URL (resolved at create; re-resolved on K8s if the Pod IP
   * changed). */
  endpoint: string;
  /** Live exec abort controllers, keyed execId. */
  liveExecs: Map<string, AbortController>;
  /** "Always-on": the idle/TTL reaper skips this session. In-memory only
   * (re-derived from the platform row after a spawner restart). */
  pinned?: boolean;
}

export class SessionRegistry {
  private readonly sessions = new Map<string, RegistrySession>();

  get(sessionId: string): RegistrySession | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  size(): number {
    return this.sessions.size;
  }

  countForOrg(organizationId: string): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.organizationId === organizationId) n += 1;
    }
    return n;
  }

  list(organizationId?: string): RegistrySession[] {
    const all = [...this.sessions.values()];
    return organizationId
      ? all.filter((s) => s.organizationId === organizationId)
      : all;
  }

  set(session: RegistrySession): void {
    this.sessions.set(session.sessionId, session);
  }

  delete(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      // Abort any in-flight execs so their SSE streams unwind.
      for (const ac of s.liveExecs.values()) ac.abort();
      this.sessions.delete(sessionId);
    }
  }

  registerExec(sessionId: string, execId: string, ac: AbortController): void {
    this.sessions.get(sessionId)?.liveExecs.set(execId, ac);
  }

  unregisterExec(sessionId: string, execId: string): void {
    this.sessions.get(sessionId)?.liveExecs.delete(execId);
  }

  getExec(sessionId: string, execId: string): AbortController | undefined {
    return this.sessions.get(sessionId)?.liveExecs.get(execId);
  }
}
