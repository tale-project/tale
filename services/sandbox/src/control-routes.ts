// Deploy control routes: `POST /v1/drain`, `GET /v1/drain-status`.
//
// The sandbox tier is a SINGLE container that deploys roll in-place via a
// serialized drain. `POST /v1/drain` flips the spawner into drain mode so it
// stops accepting NEW sessions while still serving cancels, existing-session
// execs, and `/v1/drain-status` — letting the deploy poll until in-flight work
// reaches zero before replacing the container. Unlike SIGTERM it does NOT exit
// or cancel in-flight work.
//
// Both routes are HMAC-gated like every other route (request-auth.ts). They
// used to be open "because the deploy reaches them via docker exec", but the
// listener is the same 0.0.0.0:8003 that sits on the sandbox network every
// session container shares — so any tenant's sandboxed code could freeze
// session creation deployment-wide (drain is a one-way latch) and list every
// live session id. The deploy now signs from INSIDE the container with the
// spawner's own SANDBOX_TOKEN (control-cli.ts), so `docker exec` needs no
// side door.

import { jsonResponse } from './http-util.ts';
import type { RequestAuth } from './request-auth.ts';

/** The slice of the session subsystem the status probe reads. */
export interface SessionPeek {
  sessionCount(): number;
  sessionIds(): string[];
}

export class ControlRoutes {
  private draining = false;
  // When the spawner entered drain mode (the max-linger self-reap anchor). The
  // deploy lingers a spawner that still has live sessions instead of tearing it
  // down; if the deploy dies mid-roll, this lets the spawner reclaim the
  // session compute itself once maxLingerMs elapses, so it can never hold a
  // session forever. `null` when not draining.
  private startedAt: number | null = null;
  // One-shot guard so the linger reap fires once (it stops sessions; the thin
  // spawner then sits idle until the deploy's teardown removes its container —
  // we deliberately do NOT process.exit, which `restart: unless-stopped` would
  // just bounce back into a zombie spawner).
  private lingerReaped = false;

  constructor(
    private readonly auth: RequestAuth,
    // Read the session subsystem WITHOUT constructing it: a status probe must
    // never trigger backend init. `null` = not constructed yet.
    private readonly peekSessions: () => SessionPeek | null,
  ) {}

  get isDraining(): boolean {
    return this.draining;
  }

  /**
   * Route entry. Returns `null` for anything that is not a control route so
   * the router falls through; otherwise the (401 or 200) Response.
   */
  async handle(req: Request, url: URL): Promise<Response | null> {
    const isDrain = req.method === 'POST' && url.pathname === '/v1/drain';
    const isStatus =
      req.method === 'GET' && url.pathname === '/v1/drain-status';
    if (!isDrain && !isStatus) return null;
    // Same gate as every session route: body-cap + HMAC (the control calls
    // carry an empty body, signed as sha256('')).
    const r = await this.auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return isDrain ? this.drain() : this.status();
  }

  /**
   * Max-linger self-reap (CLI-independent safety net). Returns `true` exactly
   * once: when the spawner has been draining longer than `maxLingerMs`. The
   * caller then reclaims the session compute (stop-only; workspaces preserved).
   */
  takeLingerReap(maxLingerMs: number, now: number = Date.now()): boolean {
    if (!this.draining || this.lingerReaped || this.startedAt === null) {
      return false;
    }
    if (now - this.startedAt <= maxLingerMs) return false;
    this.lingerReaped = true;
    return true;
  }

  private drain(): Response {
    if (!this.draining) {
      this.draining = true;
      this.startedAt = Date.now();
    }
    console.log('[sandbox] entered drain mode — refusing new sessions');
    return jsonResponse({ draining: true }, 200);
  }

  private status(): Response {
    const sessions = this.peekSessions();
    return jsonResponse(
      {
        draining: this.draining,
        sessions: sessions?.sessionCount() ?? 0,
        // Live session ids — the spawner lingers while any remain.
        sessionIds: sessions?.sessionIds() ?? [],
      },
      200,
    );
  }
}
