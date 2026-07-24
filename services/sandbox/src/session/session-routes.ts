// HTTP route handlers for the /v1/sessions API. Mounted by server.ts behind
// the same HMAC authorize() gate as /v1/execute. The handlers own session
// quota + registry bookkeeping; the SessionBackend owns container/Pod
// lifecycle and runnerd addressing; runnerd owns the actual exec.

import type { SessionBackend } from '../backend/types.ts';
import { jsonResponse } from '../http-util.ts';
import { sseResponse } from '../sse.ts';
import type { SpawnerConfig } from '../types.ts';
import type { SessionExecResponse, SessionInfo } from '../wire.ts';
import {
  runnerdAttach,
  runnerdBrowserControl,
  runnerdCancelExec,
  runnerdDeleteFiles,
  runnerdEnvPatch,
  runnerdExec,
  runnerdExecStatus,
  runnerdHealth,
  runnerdListDir,
  runnerdReadFile,
  runnerdStageFiles,
  runnerdWriteStdin,
} from './runnerd-client.ts';
import type { RunnerdExecEvent } from './runnerd-protocol.ts';
import type { ScreencastTarget } from './screencast-relay.ts';
import { deriveRunnerdToken } from './session-naming.ts';
import { SessionRegistry } from './session-registry.ts';
import {
  validateCreateSession,
  validateExecSession,
} from './validate-session.ts';

function b64decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export class SessionRoutes {
  private readonly registry = new SessionRegistry();
  // Session ids with a createSession in flight. The registry is only populated
  // AFTER the backend create resolves, so this Set closes the synchronous gap a
  // concurrent create of the same id would otherwise slip through.
  private readonly creating = new Set<string>();

  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly backend: SessionBackend,
  ) {}

  /** Number of live sessions this spawner currently manages (drain readiness). */
  sessionCount(): number {
    return this.registry.size();
  }

  /** Live session ids — the deploy reads these from `/v1/drain-status` to decide
   * whether to LINGER this spawner (keep it serving its sessions) rather than
   * tear it down during an in-place roll. */
  sessionIds(): string[] {
    return this.registry.list().map((s) => s.sessionId);
  }

  /** Force-stop every non-finished session (compute reclaimed, workspace
   * preserved). Used by the spawner's max-linger self-reap so a spawner that
   * lingered past its TTL can shut down without orphaning containers — even if
   * the deploy died mid-roll. Returns the number stopped. */
  async stopAllSessions(): Promise<number> {
    let stopped = 0;
    for (const s of this.registry.list()) {
      try {
        await this.backend.stopSession(s.sessionId);
        this.registry.delete(s.sessionId);
        stopped += 1;
      } catch (err) {
        console.warn(
          `[sandbox.session] linger stop failed for ${s.sessionId}:`,
          err,
        );
      }
    }
    return stopped;
  }

  /** runnerd token for a session: derived from SANDBOX_TOKEN when signed, or
   * '' in unsigned dev mode (runnerd skips the check, matching the spawner's
   * own opt-in HMAC policy). */
  private tokenFor(sessionId: string): string {
    if (this.cfg.sandboxToken === null) return '';
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
  }

  /**
   * Resolve where + how the screencast relay should dial runnerd for a session.
   * Returns the runnerd host:port (parsed from the registry's cached endpoint
   * URL) + the per-session token, or null when the session is unknown / the
   * endpoint can't be parsed. Synchronous (registry-cache only): a WS upgrade
   * already passed the HMAC gate, so a registry miss simply means "no session"
   * and the relay closes the socket — no backend round-trip on the hot path.
   */
  resolveScreencastTarget(sessionId: string): ScreencastTarget | null {
    const session = this.registry.get(sessionId);
    if (!session) return null;
    let url: URL;
    try {
      url = new URL(session.endpoint);
    } catch (err) {
      console.warn(
        `[sandbox.session] screencast endpoint unparseable for ${sessionId} (${session.endpoint}):`,
        err,
      );
      return null;
    }
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    return {
      hostname: url.hostname,
      port,
      token: this.tokenFor(sessionId),
    };
  }

  /**
   * Boot re-adoption: rebuild the in-memory registry from the backend objects
   * still running (the registry is a cache; the backend labels/annotations are
   * the source of truth). Idempotent — skips sessions already registered.
   */
  async adoptExisting(): Promise<void> {
    let sessions;
    try {
      sessions = await this.backend.listSessions();
    } catch (err) {
      console.warn('[sandbox.session] adoptExisting list failed:', err);
      return;
    }
    for (const s of sessions) {
      if (this.registry.has(s.sessionId)) continue;
      const endpoint = await this.backend
        .resolveEndpoint(s.sessionId)
        .catch(() => null);
      if (endpoint === null) continue;
      this.registry.set({
        sessionId: s.sessionId,
        organizationId: s.organizationId,
        profile: s.profile,
        state: s.state,
        createdAtMs: s.createdAtMs,
        expiresAtMs: s.createdAtMs + s.ttlMs,
        idleTimeoutMs: s.idleTimeoutMs,
        endpoint,
        liveExecs: new Map(),
      });
    }

    // Heal the shared build cache for every org with a running session. The
    // buildkitd outlives the spawner, so the same stack restart that bounced
    // this spawner may have moved sandbox-egress to a new IP — leaving the
    // daemon's egress fence stale. An adopted session that reuses it would build
    // with no DNS/egress (the createSession heal never fires for it). Best-effort
    // inside the backend; a no-op when there's no shared cache or nothing drifted.
    if (sessions.length > 0) {
      await this.backend.reconcileBuildCache(
        sessions.map((s) => s.organizationId),
      );
    }
  }

  /**
   * TTL/idle reaper, called periodically. STOPS (releases compute, PRESERVES
   * the workspace) any session past its lifetime (cheap registry check) or idle
   * past its idle timeout (queried from runnerd's activity clock, so it stays
   * correct after a spawner restart). Neither idle nor TTL deletes data — only
   * an explicit Destroy does. The next turn resumes a stopped session by
   * re-creating against the preserved workspace. Returns the number reaped.
   */
  async sweepExpired(nowMs: number = Date.now()): Promise<number> {
    let reaped = 0;
    for (const s of this.registry.list()) {
      // Pinned ("always-on") sessions are exempt from BOTH idle and TTL reap.
      if (s.pinned) continue;
      // A session with a live exec is NEVER reaped — a long, QUIET tool (no
      // stdout for >idleTimeout) would otherwise be idle-killed mid-task, and a
      // running task shouldn't be cut at the hard TTL either. The registry
      // tracks in-flight execs on this replica; after a spawner restart its
      // cache is cold, so the runnerd health.liveExecs check below is the
      // backstop for a re-adopted busy session.
      if (s.liveExecs.size > 0) continue;
      let expired = nowMs > s.expiresAtMs;
      // Local exec cache is cold (e.g. a spawner restart re-adopted this session
      // with an empty liveExecs map), so consult runnerd's own clock. This probe
      // gates BOTH the idle AND the TTL reap: a re-adopted exec that's been
      // running past the hard TTL must not be stopped mid-task just because this
      // replica's liveExecs map is empty. Run it unconditionally (not only when
      // !expired) — that's the cold-cache backstop for a busy re-adopted session.
      try {
        const health = await runnerdHealth({
          baseUrl: s.endpoint,
          token: this.tokenFor(s.sessionId),
        });
        if (health.liveExecs > 0) continue; // busy — spare from idle AND TTL
        // A live browser viewer (raw VNC tunnel piping) keeps the session alive
        // exactly like a live exec — never stop a session someone is actively
        // watching, even if no exec is running. Mirrors the liveExecs skip.
        // BUT only while the browser is actually drivable: a watched session
        // whose managed Chromium CDP is dead (cdpHealthy === false) would
        // otherwise be pinned forever staring at a stale frame, so don't spare
        // it on the viewer alone — let it age out (the next turn's pre-flight
        // recycles the browser). Absent `browser` (non-browser session) keeps
        // today's behavior.
        const cdpDead = health.browser?.cdpHealthy === false;
        if (health.activeScreencasts > 0 && !cdpDead) continue;
        if (!expired) {
          expired = nowMs - health.lastActivityAtMs > s.idleTimeoutMs;
        }
      } catch (err) {
        // runnerd unreachable. Distinguish a transient blip (leave for a
        // later sweep; the TTL is the hard backstop) from a ZOMBIE — the
        // backend object is gone but the cache entry survived. Without
        // this, a dead session lingers routable-but-unreachable until TTL.
        console.warn(
          `[sandbox.session] sweep health probe failed for ${s.sessionId} (${s.endpoint}):`,
          err,
        );
        if (await this.evictIfBackendGone(s.sessionId)) {
          reaped += 1;
          continue;
        }
        // Backend still present (transient blip): fall through to the TTL-only
        // decision below — a not-yet-expired session is left for a later sweep.
      }
      if (expired) {
        // Stop, never destroy: idle/TTL release compute but keep the workspace
        // so the session resumes with its data on the next turn. stopSession
        // THROWS on a transient backend hiccup (its contract) — keep the
        // registry entry so the next sweep retries, rather than dropping a
        // still-running container from the cache and orphaning it until a
        // restart re-adopts it.
        try {
          await this.backend.stopSession(s.sessionId);
        } catch (err) {
          console.warn(
            '[sandbox.session] sweep stop failed (will retry next sweep):',
            err,
          );
          continue;
        }
        this.registry.delete(s.sessionId);
        reaped += 1;
      }
    }
    return reaped;
  }

  private toInfo(sessionId: string): SessionInfo | null {
    const s = this.registry.get(sessionId);
    if (!s) return null;
    return {
      sessionId: s.sessionId,
      organizationId: s.organizationId,
      profile: s.profile,
      // Sourced from the registry (set at create, refreshed by adoptExisting
      // from the backend) rather than a hardcoded literal, so the wire state
      // tracks the one field that records it instead of always saying 'ready'.
      state: s.state,
      backend: this.backend.kind,
      createdAtMs: s.createdAtMs,
      lastActivityAtMs: s.createdAtMs,
      expiresAtMs: s.expiresAtMs,
      idleTimeoutMs: s.idleTimeoutMs,
    };
  }

  /**
   * Zombie-registry eviction. The registry is a cache; the backend object can
   * disappear underneath it without any spawner involvement (manual
   * `docker rm`, OOM teardown, K8s Pod eviction / node loss). A zombie entry
   * then routes runnerd calls at a dead address — the platform sees transport
   * errors instead of the definitive 404 its phantom self-heal keys on, so
   * every turn fails without recovery.
   *
   * Called from runnerd-failure paths and the aliveness probe: verifies the
   * backend object with the DEFINITIVE `sessionExists` check; on
   * confirmed-gone it evicts only the stale registry entry so this and
   * subsequent calls resolve to 404 → `SessionNotFoundError` → the platform
   * resumes the session in place (re-create against the PRESERVED workspace).
   * It does NOT delete the workspace: a gone container is now a resumable
   * stopped state, and data is removed only by an explicit Destroy. A THROWING
   * check means "can't judge" (backend hiccup): keep the entry — a transient
   * blip must never evict a live session. Returns true when a stale entry was
   * evicted.
   */
  private async evictIfBackendGone(sessionId: string): Promise<boolean> {
    if (!this.registry.has(sessionId)) return false;
    let alive: boolean;
    try {
      alive = await this.backend.sessionExists(sessionId);
    } catch (err) {
      console.warn(
        `[sandbox.session] liveness check for ${sessionId} failed (treating as alive):`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
    if (alive) return false;
    console.warn(
      `[sandbox.session] ${sessionId} backend object gone; evicting stale registry entry (workspace preserved for resume)`,
    );
    this.registry.delete(sessionId);
    return true;
  }

  async handleCreate(body: string): Promise<Response> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const v = validateCreateSession(parsed, this.cfg);
    if (!v.ok)
      return jsonResponse({ error: 'bad_request', message: v.error }, 400);
    const req = v.value;

    if (this.registry.has(req.sessionId)) {
      return jsonResponse(
        { error: 'duplicate', message: `session ${req.sessionId} exists` },
        409,
      );
    }
    if (this.registry.size() >= this.cfg.session.maxSessions) {
      return jsonResponse(
        { error: 'session_quota', message: 'spawner session cap reached' },
        429,
        { 'retry-after': '10' },
      );
    }
    if (
      this.registry.countForOrg(req.organizationId) >=
      this.cfg.session.maxSessionsPerOrg
    ) {
      return jsonResponse(
        { error: 'session_quota', message: 'org session cap reached' },
        429,
        { 'retry-after': '10' },
      );
    }

    // Reserve the id synchronously. The registry isn't populated until AFTER
    // backend.createSession resolves below, so without this a concurrent create
    // of the SAME id would slip past the registry.has() check above and race
    // into the backend — where the loser's name-conflict cleanup could
    // `docker rm` the winner's healthy container (the backend also guards
    // against rm-on-conflict as defense-in-depth).
    if (this.creating.has(req.sessionId)) {
      return jsonResponse(
        {
          error: 'duplicate',
          message: `session ${req.sessionId} is being created`,
        },
        409,
      );
    }
    this.creating.add(req.sessionId);
    try {
      const createdAtMs = Date.now();
      try {
        await this.backend.createSession({
          sessionId: req.sessionId,
          organizationId: req.organizationId,
          profile: req.profile,
          ttlMs: req.ttlMs,
          idleTimeoutMs: req.idleTimeoutMs,
          env: req.env,
          createdAtMs,
        });
      } catch (err) {
        return jsonResponse(
          {
            error: 'create_failed',
            message: err instanceof Error ? err.message : String(err),
          },
          502,
        );
      }

      let endpoint: string;
      try {
        endpoint = await this.backend.resolveEndpoint(req.sessionId);
      } catch (err) {
        // The backend object was created above but we can't address it. Roll it
        // back rather than leak an unregistered, unroutable, never-reaped session
        // (the sweep only walks the registry, so an unregistered backend object
        // lingers until a spawner restart re-adopts it).
        await this.backend.destroySession(req.sessionId).catch((destroyErr) => {
          console.warn(
            '[sandbox.session] rollback destroy after resolveEndpoint failure:',
            destroyErr,
          );
        });
        return jsonResponse(
          {
            error: 'create_failed',
            message: err instanceof Error ? err.message : String(err),
          },
          502,
        );
      }
      this.registry.set({
        sessionId: req.sessionId,
        organizationId: req.organizationId,
        profile: req.profile,
        state: 'ready',
        createdAtMs,
        expiresAtMs: createdAtMs + req.ttlMs,
        idleTimeoutMs: req.idleTimeoutMs,
        endpoint,
        liveExecs: new Map(),
      });
      return jsonResponse({ session: this.toInfo(req.sessionId) }, 201);
    } finally {
      this.creating.delete(req.sessionId);
    }
  }

  /** GET /v1/sessions/:id — the platform's pre-turn aliveness probe keys its
   * phantom-recreate on this route's 404, so a registry hit must be verified
   * against the backend object: answering from the cache alone turns a dead
   * container into "alive" and the turn then fails on a dead address. */
  async handleGet(sessionId: string): Promise<Response> {
    if (await this.evictIfBackendGone(sessionId)) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    const info = this.toInfo(sessionId);
    if (!info) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ session: info }, 200);
  }

  handleList(organizationId: string | null): Response {
    const sessions = this.registry
      .list(organizationId ?? undefined)
      .map((s) => this.toInfo(s.sessionId))
      .filter((s): s is SessionInfo => s !== null);
    return jsonResponse({ sessions }, 200);
  }

  async handleDestroy(
    sessionId: string,
    opts: { ifIdle?: boolean } = {},
  ): Promise<Response> {
    // Conditional destroy (`?if_idle=1`): a janitor caller (the end-of-turn
    // thread-session teardown) must never destroy a session another turn is
    // actively executing in — two turns can share one thread session (e.g.
    // the model invoking the same delegate twice in parallel onto one
    // sub-thread). Busy is decided HERE, not by the caller: the spawner owns
    // the live-exec truth. The skip is always safe — the surviving turn's own
    // teardown (or the TTL reaper) cleans up later; destroying a live exec
    // never is.
    if (opts.ifIdle && (await this.hasLiveExecs(sessionId))) {
      return jsonResponse({ destroyed: false, busy: true }, 200);
    }
    // Delete from the registry BEFORE awaiting the backend so a concurrent
    // destroy of the same id sees an empty cache and can't double-call
    // destroySession. The backend destroy then runs exactly once; its return
    // value (false = nothing existed) covers the adopted-but-unregistered case.
    const entry = this.registry.get(sessionId);
    const had = entry !== undefined;
    if (had) this.registry.delete(sessionId);
    try {
      const backendExisted = await this.backend.destroySession(sessionId);
      return jsonResponse(
        { destroyed: had || backendExisted, busy: false },
        200,
      );
    } catch (err) {
      // The backend destroy FAILED (a wedged dockerd, an apiserver blip). Do
      // NOT report success: the container/workspace may survive, and laundering
      // it to a 200 would flip the platform's session row `destroyed` while the
      // user's data lives on — the "success toast, workspace survives" defect.
      // Restore the registry entry so the session isn't lost, and surface the
      // failure so the caller retries.
      console.error('[sandbox.session] destroy backend failed:', err);
      if (entry !== undefined) this.registry.set(entry);
      return jsonResponse(
        { destroyed: false, busy: false, error: 'backend destroy failed' },
        502,
      );
    }
  }

  /**
   * Does the session have a live exec — or is it in an unknown-but-possibly-
   * live state? Mirrors sweepExpired's two-tier check: this replica's
   * in-flight registry map first, then runnerd's own `liveExecs` counter as
   * the cold-cache backstop (correct after a spawner restart). A failed probe
   * is "unknown", not "idle": only a backend object that is definitively gone
   * may report not-busy, so a wedged-but-alive container is left to the
   * reaper rather than destroyed under a possibly-running exec.
   */
  private async hasLiveExecs(sessionId: string): Promise<boolean> {
    const s = this.registry.get(sessionId);
    if (s !== undefined && s.liveExecs.size > 0) return true;
    const endpoint =
      s?.endpoint ??
      (await this.backend.resolveEndpoint(sessionId).catch(() => null));
    if (endpoint === null) {
      return this.backend.sessionExists(sessionId).catch(() => true);
    }
    try {
      const health = await runnerdHealth({
        baseUrl: endpoint,
        token: this.tokenFor(sessionId),
      });
      return health.liveExecs > 0;
    } catch {
      return this.backend.sessionExists(sessionId).catch(() => true);
    }
  }

  /** POST /v1/sessions/:id/exec — proxies runnerd's NDJSON stream to SSE,
   * mirroring the /v1/execute event grammar. */
  handleExec(req: Request, sessionId: string, body: string): Response {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const v = validateExecSession(parsed, this.cfg);
    if (!v.ok)
      return jsonResponse({ error: 'bad_request', message: v.error }, 400);
    const execReq = v.value;

    const ac = new AbortController();
    const abortHandler = () => ac.abort();
    req.signal.addEventListener('abort', abortHandler, { once: true });
    this.registry.registerExec(sessionId, execReq.execId, ac);

    const token = this.tokenFor(sessionId);
    // collectOutput (default true): accumulate stdout/stderr into the terminal
    // `result` buffers (one-shot contract). A long-lived streaming exec (the
    // agent) passes false — the live SSE is the sole delivery, so we skip
    // accumulation (no unbounded growth for a never-exiting exec) and tell
    // runnerd the cap is unlimited (0) so its output is never silently cut off.
    const collect = execReq.collectOutput ?? true;
    return sseResponse(async ({ send }) => {
      // Terminal-state accumulation so the SSE `result` event matches the
      // one-shot ExecuteResponse contract (the runnerd `exit` carries
      // truncation/timeout; stdout/stderr are summed here for the buffers).
      // Skipped entirely when collect=false — the buffers stay empty.
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let result: SessionExecResponse | null = null;
      const onEvent = (e: RunnerdExecEvent) => {
        switch (e.t) {
          case 'start':
            send('phase', { phase: 'running' });
            break;
          case 'stdout': {
            const bytes = b64decode(e.b64);
            if (collect) stdoutChunks.push(bytes);
            send('stdout', {
              text: new TextDecoder().decode(bytes),
              seq: e.seq,
            });
            break;
          }
          case 'stderr': {
            const bytes = b64decode(e.b64);
            if (collect) stderrChunks.push(bytes);
            send('stderr', {
              text: new TextDecoder().decode(bytes),
              seq: e.seq,
            });
            break;
          }
          case 'exit':
            result = {
              status: e.cancelled
                ? 'cancelled'
                : e.exitCode === 0
                  ? 'completed'
                  : 'failed',
              exitCode: e.exitCode,
              durationMs: e.durationMs,
              stdoutBase64: concatBase64(stdoutChunks),
              stderrBase64: concatBase64(stderrChunks),
              truncated: e.truncated,
              // Only mark TIMEOUT when the exit wasn't clean: a process that
              // raced the deadline and still exited 0 genuinely `completed`, so
              // pairing it with errorCode:'TIMEOUT' is a contradictory result.
              ...(e.timedOut && e.exitCode !== 0
                ? { errorCode: 'TIMEOUT' as const }
                : {}),
            };
            break;
          case 'fail':
            result = {
              status: 'failed',
              exitCode: null,
              // Sentinel: the process never ran, so there is no runnerd
              // measurement to forward (wire.ts `durationMs` contract).
              durationMs: 0,
              stdoutBase64: '',
              stderrBase64: '',
              truncated: { stdout: false, stderr: false },
              errorCode:
                e.code === 'INVALID_CWD' ? 'INVALID_CWD' : 'RUNTIME_ERROR',
              errorMessage: e.message,
            };
            break;
        }
      };
      try {
        await runnerdExec(
          { baseUrl: session.endpoint, token },
          {
            execId: execReq.execId,
            ...(execReq.command ? { command: execReq.command } : {}),
            ...(execReq.shell ? { shell: execReq.shell } : {}),
            ...(execReq.cwd ? { cwd: execReq.cwd } : {}),
            ...(execReq.env ? { env: execReq.env } : {}),
            ...(execReq.stdinBase64
              ? { stdinBase64: execReq.stdinBase64 }
              : {}),
            ...(execReq.stdinMode ? { stdinMode: execReq.stdinMode } : {}),
            timeoutMs: execReq.timeoutMs,
            // 0 = unlimited for streaming execs (collect=false): runnerd never
            // truncates the live stream; memory stays bounded by its ring.
            stdoutMaxBytes: collect ? this.cfg.stdoutMaxBytes : 0,
            stderrMaxBytes: collect ? this.cfg.stderrMaxBytes : 0,
          },
          onEvent,
          ac.signal,
        );
        if (result) {
          send('result', result);
        } else {
          // Stream ended without a terminal event — runnerd/ container died.
          send('result', {
            status: 'failed',
            exitCode: null,
            // Sentinel: the terminal `exit` line was lost with the container,
            // so there is no measurement to forward (wire.ts contract).
            durationMs: 0,
            stdoutBase64: concatBase64(stdoutChunks),
            stderrBase64: concatBase64(stderrChunks),
            truncated: { stdout: false, stderr: false },
            errorCode: 'SESSION_LOST',
            errorMessage: 'runnerd stream ended without a terminal event',
          } satisfies SessionExecResponse);
          // Mid-exec container death: evict the zombie now so the platform's
          // reconnect/next turn gets the definitive 404 instead of retrying a
          // dead address.
          await this.evictIfBackendGone(sessionId);
        }
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
        // A transport-level runnerd failure on a gone container must convert
        // the platform's resilient-drain retry into a 404 (registry miss),
        // not another connection error.
        await this.evictIfBackendGone(sessionId);
      } finally {
        this.registry.unregisterExec(sessionId, execReq.execId);
        req.signal.removeEventListener('abort', abortHandler);
      }
    });
  }

  async handleExecCancel(sessionId: string, execId: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    // Local abort (ends the SSE proxy) + tell runnerd to kill the process group.
    this.registry.getExec(sessionId, execId)?.abort();
    let killed: boolean;
    try {
      killed = await runnerdCancelExec(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
      );
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        // Container gone → nothing left to kill; the cancel is moot.
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse({ killed }, 200);
  }

  /** POST /v1/sessions/:id/browser/{restart,reset,close-pages} — recycle the
   * managed live-browser Chromium (restart preserves logins, reset wipes the
   * profile) or reset its tabs (close-pages). Proxies to runnerd; a gone backend
   * → 404, a transport blip → 502 (same ladder as cancel). Off-feature sessions
   * answer a benign no-op (runnerd gates on TALE_BROWSER_CDP). */
  async handleBrowserControl(
    sessionId: string,
    action: string,
  ): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    if (
      action !== 'restart' &&
      action !== 'reset' &&
      action !== 'close-pages'
    ) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    try {
      const body = await runnerdBrowserControl(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        action,
      );
      return jsonResponse(body, 200);
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  }

  /** GET /v1/sessions/:id/exec/:execId — per-exec status without consuming the
   * stream. `running`/`exited` (200) or `gone` (404: session lost, or exec
   * evicted past the recent window). A transport blip with a live backend
   * returns 502 so the platform's restorative watchdog treats it as "unknown"
   * and skips (never finalizes a turn on a daemon hiccup). */
  async handleExecStatus(sessionId: string, execId: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ execId, state: 'gone' }, 404);
    try {
      const status = await runnerdExecStatus(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
      );
      return jsonResponse(status, status.state === 'gone' ? 404 : 200);
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ execId, state: 'gone' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  }

  /** POST /v1/sessions/:id/exec/:execId/stdin — append a line to a held-open
   * exec stdin (stdinMode:'hold') or close it. Transport failures return 502
   * (after gone-backend eviction) so the platform can distinguish "session
   * lost" from runnerd's structured STDIN_CLOSED/NOT_FOUND refusals (200). */
  async handleExecStdin(
    sessionId: string,
    execId: string,
    body: string,
  ): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { b64?: string; eof?: boolean };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as { b64?: string; eof?: boolean };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    if (parsed.b64 !== undefined && typeof parsed.b64 !== 'string') {
      return jsonResponse(
        { error: 'bad_request', message: 'b64 must be a string' },
        400,
      );
    }
    try {
      const result = await runnerdWriteStdin(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
        {
          ...(typeof parsed.b64 === 'string' ? { b64: parsed.b64 } : {}),
          ...(parsed.eof === true ? { eof: true } : {}),
        },
      );
      return jsonResponse(result, 200);
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  }

  /** GET /v1/sessions/:id/exec/:execId/attach — reconnect to a running or
   * just-finished exec; replays runnerd's ring then follows to exit. The
   * resilience path for a platform action that dropped its original SSE. */
  handleExecAttach(req: Request, sessionId: string, execId: string): Response {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.signal.addEventListener('abort', onAbort, { once: true });
    // Resume cursor: the platform passes the highest seq it already consumed so
    // runnerd replays only newer events (idempotent reconnect).
    const sinceSeq =
      Number(new URL(req.url).searchParams.get('sinceSeq') ?? '0') || 0;
    const token = this.tokenFor(sessionId);
    return sseResponse(async ({ send }) => {
      try {
        const found = await runnerdAttach(
          { baseUrl: session.endpoint, token },
          execId,
          (e) => forwardExecEvent(e, send),
          ac.signal,
          sinceSeq,
        );
        if (!found) send('error', { message: `exec ${execId} not found` });
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
        // See handleExec: a dead backend object must surface as 404 on the
        // next reconnect, not as an endless transport error.
        await this.evictIfBackendGone(sessionId);
      } finally {
        req.signal.removeEventListener('abort', onAbort);
      }
    });
  }

  /** PATCH /v1/sessions/:id/env — set/unset session env (the hook the
   * credential/gateway-token injection uses). */
  async handleEnvPatch(sessionId: string, body: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { set?: Record<string, string>; unset?: string[] };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as {
        set?: Record<string, string>;
        unset?: string[];
      };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let denied: string[];
    try {
      denied = await runnerdEnvPatch(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        { set: parsed.set, unset: parsed.unset },
      );
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse({ ok: true, denied }, 200);
  }

  /** PATCH /v1/sessions/:id/pin — toggle "always-on". Pinned sessions are
   * exempt from the idle/TTL reaper; unpinning restores a fresh normal TTL.
   * In-memory only (the platform row is the durable truth; re-pushed on the
   * next turn after a spawner restart). */
  handleSetPinned(sessionId: string, body: string): Response {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { pinned?: boolean };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as { pinned?: boolean };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const pinned = parsed.pinned === true;
    session.pinned = pinned;
    if (!pinned) {
      // Give an unpinned session a fresh lifetime so it isn't reaped instantly.
      session.expiresAtMs = Date.now() + this.cfg.session.maxLifetimeMs;
    }
    return jsonResponse({ ok: true, pinned }, 200);
  }

  /** POST /v1/sessions/:id/files/stage — write files into /user (inline
   * base64 content, or presigned URLs the daemon fetches). */
  async handleFilesStage(sessionId: string, body: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: {
      files?: Array<{ path: string; url?: string; contentBase64?: string }>;
    };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as {
        files?: Array<{ path: string; url?: string; contentBase64?: string }>;
      };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let result;
    try {
      result = await runnerdStageFiles(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        parsed.files ?? [],
      );
    } catch (err) {
      // Evict a zombie but answer 502, NOT 404 — the file routes' 404 already
      // means "path not found" platform-side; a session-gone 404 here would
      // be misread. The eviction makes the next aliveness probe 404 instead.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse(result, 200);
  }

  /** POST /v1/sessions/:id/files/delete — remove paths (file or dir) from
   * /user. Idempotent reconcile primitive (e.g. pruning stale skills). */
  async handleFilesDelete(sessionId: string, body: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { paths?: string[] };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as { paths?: string[] };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let result;
    try {
      result = await runnerdDeleteFiles(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        parsed.paths ?? [],
      );
    } catch (err) {
      // 502 not 404 — see handleFilesStage.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse(result, 200);
  }

  /** GET /v1/sessions/:id/files?path= — directory listing. */
  async handleFilesList(sessionId: string, path: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let entries;
    try {
      entries = await runnerdListDir(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        path,
      );
    } catch (err) {
      // 502 not 404 — see handleFilesStage.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    if (entries === null) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ entries }, 200);
  }

  /** GET /v1/sessions/:id/files/content?path= — raw file bytes streamed
   * through the spawner. */
  async handleFileContent(sessionId: string, path: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let bytes;
    try {
      bytes = await runnerdReadFile(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        path,
      );
    } catch (err) {
      // 502 not 404 — see handleFilesStage.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    if (bytes === null) return jsonResponse({ error: 'not_found' }, 404);
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
}

/** Translate a runnerd exec NDJSON event into the SSE event grammar used by
 * both /exec and /exec/:id/attach. */
function forwardExecEvent(
  e: RunnerdExecEvent,
  send: (event: string, data: unknown) => void,
): void {
  switch (e.t) {
    case 'start':
      send('phase', { phase: 'running' });
      break;
    case 'stdout':
      send('stdout', {
        text: new TextDecoder().decode(b64decode(e.b64)),
        seq: e.seq,
      });
      break;
    case 'stderr':
      send('stderr', {
        text: new TextDecoder().decode(b64decode(e.b64)),
        seq: e.seq,
      });
      break;
    case 'exit':
      send('result', {
        status: e.cancelled
          ? 'cancelled'
          : e.exitCode === 0
            ? 'completed'
            : 'failed',
        exitCode: e.exitCode,
        durationMs: e.durationMs,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: e.truncated,
        // See handleExec: a clean exit (0) that raced the deadline genuinely
        // completed — don't pair it with a contradictory TIMEOUT marker.
        ...(e.timedOut && e.exitCode !== 0
          ? { errorCode: 'TIMEOUT' as const }
          : {}),
      } satisfies SessionExecResponse);
      break;
    case 'fail':
      send('result', {
        status: 'failed',
        exitCode: null,
        // Sentinel: the process never ran, so there is no runnerd
        // measurement to forward (wire.ts `durationMs` contract).
        durationMs: 0,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: { stdout: false, stderr: false },
        errorCode: e.code === 'INVALID_CWD' ? 'INVALID_CWD' : 'RUNTIME_ERROR',
        errorMessage: e.message,
      } satisfies SessionExecResponse);
      break;
  }
}

function concatBase64(chunks: Uint8Array[]): string {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return Buffer.from(out).toString('base64');
}
