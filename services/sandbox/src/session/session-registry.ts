// In-memory session registry — a CACHE, not the source of truth.
//
// The authoritative state is the backend objects (container/Pod labels +
// annotations) plus runnerd's activity clock. This map is a hot-path cache so
// the route layer doesn't hit the backend on every exec; on a miss (a peer
// replica created the session, or this spawner missed it at boot) the route
// layer re-resolves from the backend by deterministic name
// (SessionRoutes.ensureRegistered) and the periodic sweep re-adopts whatever
// the backend lists. Per-exec AbortControllers live here too, keyed
// sessionId/execId, so cancel can find them; so do those of the attach
// streams runnerd has answered, under a key no exec id can take: they count
// as work in flight, and cancel never finds them.

import type { SandboxSessionProfile, SandboxSessionState } from '../wire.ts';

export interface RegistrySession {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  /** Actual capability of the running incarnation, independent of new defaults. */
  docker?: boolean;
  state: SandboxSessionState;
  createdAtMs: number;
  expiresAtMs: number;
  idleTimeoutMs: number;
  /** runnerd base URL (resolved at create; re-resolved on K8s if the Pod IP
   * changed). */
  endpoint: string;
  /** Live exec abort controllers, keyed execId, and those of the attach
   * streams runnerd has answered, each under its own key holding a '/' (no
   * exec id does). The session is busy while any is here. */
  liveExecs: Map<string, AbortController>;
  /** "Always-on": the idle/TTL reaper skips this session. In-memory only
   * (re-derived from the platform row after a spawner restart). */
  pinned?: boolean;
  /** runnerd's activity clock as the last sweep read it — how pressure
   * reclamation picks the session idle longest. */
  lastActivityAtMs?: number;
  /** The egress proxy address this incarnation pinned at boot, as its
   * backend recorded it; the sweep recycles the session once the proxy has
   * moved away from it. */
  egressAddress?: string;
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
      // Abort any in-flight execs and attach streams so their SSE streams
      // unwind.
      for (const ac of s.liveExecs.values()) ac.abort();
      this.sessions.delete(sessionId);
    }
  }

  registerExec(sessionId: string, execId: string, ac: AbortController): void {
    this.sessions.get(sessionId)?.liveExecs.set(execId, ac);
  }

  /** Take a stream's key out of the entry the stream registered in, while
   * the key still holds that stream's controller. By the entry, not the id:
   * a destroy that fails puts the same entry back after the registry dropped
   * it, and a key left in it would keep the session busy until a restart,
   * while a replacement under the id never held the key. By the controller:
   * a later stream under the same exec id keeps its own. */
  unregisterExec(
    session: RegistrySession,
    execId: string,
    ac: AbortController,
  ): void {
    if (session.liveExecs.get(execId) === ac) session.liveExecs.delete(execId);
  }

  getExec(sessionId: string, execId: string): AbortController | undefined {
    return this.sessions.get(sessionId)?.liveExecs.get(execId);
  }
}
