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
  runnerdCancelExec,
  runnerdEnvPatch,
  runnerdExec,
  runnerdHealth,
  runnerdListDir,
  runnerdReadFile,
  runnerdStageFiles,
} from './runnerd-client.ts';
import type { RunnerdExecEvent } from './runnerd-protocol.ts';
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

  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly backend: SessionBackend,
  ) {}

  /** runnerd token for a session: derived from SANDBOX_TOKEN when signed, or
   * '' in unsigned dev mode (runnerd skips the check, matching the spawner's
   * own opt-in HMAC policy). */
  private tokenFor(sessionId: string): string {
    if (this.cfg.sandboxToken === null) return '';
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
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
  }

  /**
   * TTL/idle reaper, called periodically. Destroys sessions past their
   * lifetime (cheap registry check) or idle past their idle timeout (queried
   * from runnerd's activity clock, so it stays correct after a spawner
   * restart). Returns the number reaped.
   */
  async sweepExpired(nowMs: number = Date.now()): Promise<number> {
    let reaped = 0;
    for (const s of this.registry.list()) {
      let expired = nowMs > s.expiresAtMs;
      if (!expired) {
        try {
          const health = await runnerdHealth({
            baseUrl: s.endpoint,
            token: this.tokenFor(s.sessionId),
          });
          expired = nowMs - health.lastActivityAtMs > s.idleTimeoutMs;
        } catch {
          // runnerd unreachable — leave for a later sweep (a transient blip
          // shouldn't reap a session; the TTL is the hard backstop).
        }
      }
      if (expired) {
        await this.backend.destroySession(s.sessionId).catch((err) => {
          console.warn('[sandbox.session] sweep destroy failed:', err);
        });
        this.registry.delete(s.sessionId);
        reaped += 1;
      }
    }
    return reaped;
  }

  private toInfo(
    sessionId: string,
    state: SessionInfo['state'],
  ): SessionInfo | null {
    const s = this.registry.get(sessionId);
    if (!s) return null;
    return {
      sessionId: s.sessionId,
      organizationId: s.organizationId,
      profile: s.profile,
      state,
      backend: this.backend.kind,
      createdAtMs: s.createdAtMs,
      lastActivityAtMs: s.createdAtMs,
      expiresAtMs: s.expiresAtMs,
      idleTimeoutMs: s.idleTimeoutMs,
    };
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

    const endpoint = await this.backend.resolveEndpoint(req.sessionId);
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
    return jsonResponse({ session: this.toInfo(req.sessionId, 'ready') }, 201);
  }

  handleGet(sessionId: string): Response {
    const info = this.toInfo(sessionId, 'ready');
    if (!info) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ session: info }, 200);
  }

  handleList(organizationId: string | null): Response {
    const sessions = this.registry
      .list(organizationId ?? undefined)
      .map((s) => this.toInfo(s.sessionId, 'ready'))
      .filter((s): s is SessionInfo => s !== null);
    return jsonResponse({ sessions }, 200);
  }

  async handleDestroy(sessionId: string): Promise<Response> {
    const existed =
      this.registry.has(sessionId) ||
      (await this.backend.destroySession(sessionId).catch(() => false));
    if (this.registry.has(sessionId)) {
      await this.backend.destroySession(sessionId).catch((err) => {
        console.warn('[sandbox.session] destroy backend failed:', err);
      });
      this.registry.delete(sessionId);
    }
    return jsonResponse({ destroyed: existed }, 200);
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
    return sseResponse(async ({ send }) => {
      // Terminal-state accumulation so the SSE `result` event matches the
      // one-shot ExecuteResponse contract (the runnerd `exit` carries
      // truncation/timeout; stdout/stderr are summed here for the buffers).
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
            stdoutChunks.push(bytes);
            send('stdout', { text: new TextDecoder().decode(bytes) });
            break;
          }
          case 'stderr': {
            const bytes = b64decode(e.b64);
            stderrChunks.push(bytes);
            send('stderr', { text: new TextDecoder().decode(bytes) });
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
              ...(e.timedOut ? { errorCode: 'TIMEOUT' as const } : {}),
            };
            break;
          case 'fail':
            result = {
              status: 'failed',
              exitCode: null,
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
            timeoutMs: execReq.timeoutMs,
            stdoutMaxBytes: this.cfg.stdoutMaxBytes,
            stderrMaxBytes: this.cfg.stderrMaxBytes,
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
            durationMs: 0,
            stdoutBase64: concatBase64(stdoutChunks),
            stderrBase64: concatBase64(stderrChunks),
            truncated: { stdout: false, stderr: false },
            errorCode: 'SESSION_LOST',
            errorMessage: 'runnerd stream ended without a terminal event',
          } satisfies SessionExecResponse);
        }
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
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
    const killed = await runnerdCancelExec(
      { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
      execId,
    );
    return jsonResponse({ killed }, 200);
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
    const token = this.tokenFor(sessionId);
    return sseResponse(async ({ send }) => {
      try {
        const found = await runnerdAttach(
          { baseUrl: session.endpoint, token },
          execId,
          (e) => forwardExecEvent(e, send),
          ac.signal,
        );
        if (!found) send('error', { message: `exec ${execId} not found` });
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
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
    const denied = await runnerdEnvPatch(
      { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
      { set: parsed.set, unset: parsed.unset },
    );
    return jsonResponse({ ok: true, denied }, 200);
  }

  /** POST /v1/sessions/:id/files/stage — fetch presigned URLs into /workspace. */
  async handleFilesStage(sessionId: string, body: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { files?: Array<{ path: string; url: string }> };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as {
        files?: Array<{ path: string; url: string }>;
      };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const result = await runnerdStageFiles(
      { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
      parsed.files ?? [],
    );
    return jsonResponse(result, 200);
  }

  /** GET /v1/sessions/:id/files?path= — directory listing. */
  async handleFilesList(sessionId: string, path: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    const entries = await runnerdListDir(
      { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
      path,
    );
    if (entries === null) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ entries }, 200);
  }

  /** GET /v1/sessions/:id/files/content?path= — raw file bytes streamed
   * through the spawner. */
  async handleFileContent(sessionId: string, path: string): Promise<Response> {
    const session = this.registry.get(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    const bytes = await runnerdReadFile(
      { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
      path,
    );
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
      send('stdout', { text: new TextDecoder().decode(b64decode(e.b64)) });
      break;
    case 'stderr':
      send('stderr', { text: new TextDecoder().decode(b64decode(e.b64)) });
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
        ...(e.timedOut ? { errorCode: 'TIMEOUT' as const } : {}),
      } satisfies SessionExecResponse);
      break;
    case 'fail':
      send('result', {
        status: 'failed',
        exitCode: null,
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
