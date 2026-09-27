// The device hub — runs inside the deployment's spawner (the one process every
// platform worker already calls) and makes an organization's connected
// devices look like more places a session can live.
//
// Devices dial in on a dedicated port (SANDBOX_HUB_PORT, published through
// the proxy at /sandbox/tunnel) with a ticket the platform minted. The hub
// then:
//   - places NEW sessions that may run on a device (create `placement:
//     'device'`) on the organization's least-loaded compatible device, and
//     falls back to the local backend when none has room;
//   - remembers each placement on disk (placements.ts) and sends every later
//     call for that session to its device — a device that is offline answers
//     503 `device_offline`, never a 404 the platform would read as "gone".
//     Only placements the hub made route anywhere: a device's own report of
//     what it holds never claims a session id;
//   - relays the device's sessions' calls back to the platform's backend and
//     LLM gateway along the allowlisted paths (relay-policy.ts).
//
// Only the WebSocket upgrade and a health probe listen on the hub port; the
// signed spawner API stays on the internal network.

import { join } from 'node:path';

import { jsonResponse } from '../http-util.ts';
import {
  parseHello,
  parseStatus,
  versionsCompatible,
  type DeviceHello,
  type DevicePlatform,
  type DeviceResources,
  type DeviceSessionReport,
  type DeviceStatus,
  type DeviceUpdateReport,
} from './messages.ts';
import { PlacementStore } from './placements.ts';
import {
  forwardableHeaders,
  isRelayName,
  relayMethodAllowed,
  relayPath,
  relayRequestHeaders,
  toHeaders,
  type RelayName,
} from './relay-policy.ts';
import { verifyDeviceTicket, type DeviceTicket } from './ticket.ts';
import {
  FRAME,
  TUNNEL_CLOSE,
  TUNNEL_PROTOCOL_VERSION,
  TunnelBusyError,
  TunnelEndpoint,
  type ControlFrameType,
  type IncomingStream,
  type TunnelTransport,
} from './tunnel.ts';

/** Where devices connect — the path the proxy forwards to the hub port. */
export const TUNNEL_PATH = '/sandbox/tunnel';
/** How often a device reports; three silent intervals close its tunnel. */
const STATUS_INTERVAL_MS = 15_000;
const TICKET_SWEEP_MS = 30_000;
/** How long a removal outlives the device's tickets: none lives longer. */
const REVOCATION_MEMORY_MS = 60 * 60 * 1000;
/** How long a device that failed a create outright sits out new ones. */
const CREATE_FAILURE_COOLDOWN_MS = 60_000;
/** Header naming the device a forwarded answer came from (or is missing). */
export const DEVICE_HEADER = 'x-tale-sandbox-device';

export interface HubOptions {
  /** SANDBOX_TOKEN — verifies the platform's connect tickets. */
  token: string;
  /** This spawner's release (TALE_VERSION). */
  version: string;
  /** Where the placement file lives (persistent volume). */
  stateDir: string;
  /** The real services behind each relay, e.g. `http://backend-api:3005`. */
  relays: Partial<Record<RelayName, string>>;
  /** Does the local backend already hold this session (running, or a
   * stopped workspace)? A local session never moves to a device. */
  isLocalSession: (sessionId: string) => Promise<boolean>;
  fetch?: (input: string, init: RelayFetchInit) => Promise<Response>;
  now?: () => number;
}

/** A relay fetch's options: Bun's `decompress: false` keeps the upstream's
 * bytes (and its `content-encoding`) exactly as they came. */
export type RelayFetchInit = RequestInit & { decompress?: boolean };

interface ConnectedDevice {
  deviceId: string;
  organizationId: string;
  endpoint: TunnelEndpoint;
  transport: TunnelTransport;
  connectedAtMs: number;
  ticketExpiresAtMs: number;
  lastMessageAtMs: number;
  hello: DeviceHello | null;
  status: DeviceStatus | null;
  /** Creates forwarded since the device's last STATUS counted them. */
  inflightCreates: number;
  /** Passed over for new creates until then: its last one failed outright. */
  createFailedUntilMs: number;
}

/** One connected device as `GET /v1/devices` reports it. */
export interface DeviceSummary {
  deviceId: string;
  connectedAtMs: number;
  version: string | null;
  compatible: boolean;
  maxSessions: number | null;
  sessions: { running: number; starting: number };
  resources: DeviceResources | null;
  platform: DevicePlatform | null;
  update: DeviceUpdateReport;
}

/** What a device connection hands back to the socket glue. */
export interface DeviceConnection {
  receive(frame: Uint8Array): void;
  drained(): void;
  closed(): void;
}

function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/v1\/sessions\/([a-zA-Z0-9_-]{1,64})(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}

function readCreate(body: string): {
  sessionId: string;
  organizationId: string;
  placement: unknown;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const sessionId: unknown = Reflect.get(parsed, 'sessionId');
  const organizationId: unknown = Reflect.get(parsed, 'organizationId');
  if (typeof sessionId !== 'string' || typeof organizationId !== 'string') {
    return null;
  }
  return {
    sessionId,
    organizationId,
    placement: Reflect.get(parsed, 'placement'),
  };
}

/** Drop an answer nobody will read. */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch((err: unknown) => {
    console.warn(
      `[sandbox.devices] discarding a ${res.status} body failed:`,
      err,
    );
  });
}

function offline(deviceId: string): Response {
  return jsonResponse(
    {
      error: 'device_offline',
      deviceId,
      message:
        'The device this sandbox runs on is not connected. Its workspace stays there; work resumes when the device reconnects.',
    },
    503,
    { 'retry-after': '30', [DEVICE_HEADER]: deviceId },
  );
}

export class DeviceHub {
  private readonly devices = new Map<string, ConnectedDevice>();
  /** Removed devices → when: their unexpired tickets must not reconnect. */
  private readonly revoked = new Map<string, number>();
  private readonly placements: PlacementStore;
  private readonly fetchImpl: (
    input: string,
    init: RelayFetchInit,
  ) => Promise<Response>;
  /** Creates forwarded per session id — a destroy only forgets a placement
   * when no create for the same id was forwarded while it ran. */
  private readonly creates = new Map<string, number>();
  private readonly now: () => number;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: HubOptions) {
    this.placements = new PlacementStore(
      join(opts.stateDir, 'placements.json'),
    );
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
  }

  async start(): Promise<void> {
    await this.placements.load();
    this.sweep = setInterval(() => this.closeStale(), TICKET_SWEEP_MS);
  }

  stop(): void {
    if (this.sweep !== null) clearInterval(this.sweep);
    this.sweep = null;
    for (const device of this.devices.values()) {
      device.transport.close(TUNNEL_CLOSE.GOING_AWAY, 'hub shutting down');
      device.endpoint.close();
    }
    this.devices.clear();
  }

  /** Verify the `Authorization: Bearer <ticket>` of an upgrade request. */
  authenticate(req: Request): DeviceTicket | null {
    const header = req.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) return null;
    const verified = verifyDeviceTicket(match[1], this.opts.token, this.now());
    if (!verified.ok) {
      console.warn(
        `[sandbox.devices] refused a device ticket (${verified.reason})`,
      );
      return null;
    }
    // A ticket minted before the organization removed the device is still
    // validly signed; the platform mints none after.
    const revokedAt = this.revoked.get(verified.ticket.deviceId);
    if (revokedAt !== undefined && verified.ticket.issuedAtMs <= revokedAt) {
      console.warn(
        `[sandbox.devices] refused a ticket of removed device ${verified.ticket.deviceId}`,
      );
      return null;
    }
    return verified.ticket;
  }

  /** Register a newly upgraded socket. A second connection for the same
   * device replaces the first (the old one is told why). */
  attach(ticket: DeviceTicket, transport: TunnelTransport): DeviceConnection {
    const previous = this.devices.get(ticket.deviceId);
    if (previous) {
      previous.transport.close(
        TUNNEL_CLOSE.REPLACED,
        'another connection authenticated as this device',
      );
      previous.endpoint.close();
    }
    const now = this.now();
    const device: ConnectedDevice = {
      deviceId: ticket.deviceId,
      organizationId: ticket.organizationId,
      transport,
      endpoint: new TunnelEndpoint('hub', transport, {
        onStream: (stream) => {
          void this.relay(device, stream);
        },
        onControl: (type, payload) => this.control(device, type, payload),
      }),
      connectedAtMs: now,
      ticketExpiresAtMs: ticket.expiresAtMs,
      lastMessageAtMs: now,
      hello: null,
      status: null,
      inflightCreates: 0,
      createFailedUntilMs: 0,
    };
    this.devices.set(ticket.deviceId, device);
    console.log(
      `[sandbox.devices] device ${ticket.deviceId} connected (org ${ticket.organizationId})`,
    );
    return {
      receive: (frame) => {
        device.lastMessageAtMs = this.now();
        device.endpoint.receive(frame);
      },
      drained: () => device.endpoint.notifyDrained(),
      closed: () => {
        device.endpoint.close();
        if (this.devices.get(device.deviceId) === device) {
          this.devices.delete(device.deviceId);
          console.log(
            `[sandbox.devices] device ${device.deviceId} disconnected`,
          );
        }
      },
    };
  }

  /**
   * Route a verified session call. `null` = the local backend serves it;
   * otherwise the device's (or the offline) answer. Called for every
   * `/v1/sessions…` request after its signature checked out.
   */
  async maybeForward(
    req: Request,
    url: URL,
    body: string,
  ): Promise<Response | null> {
    if (req.method === 'POST' && url.pathname === '/v1/sessions') {
      return this.routeCreate(req, url, body);
    }
    const sessionId = sessionIdFromPath(url.pathname);
    if (sessionId === null) return null;
    const placement = this.placements.get(sessionId);
    if (placement === undefined) return null;
    const createsBefore = this.creates.get(sessionId) ?? 0;
    const res = await this.forward(placement.deviceId, req, url, body);
    if (
      req.method === 'DELETE' &&
      url.pathname === `/v1/sessions/${sessionId}`
    ) {
      return this.afterDestroy(sessionId, res, createsBefore);
    }
    return res;
  }

  /** Connected devices of one organization. */
  devicesFor(organizationId: string): DeviceSummary[] {
    const out: DeviceSummary[] = [];
    for (const d of this.devices.values()) {
      if (d.organizationId !== organizationId || d.hello === null) continue;
      out.push({
        deviceId: d.deviceId,
        connectedAtMs: d.connectedAtMs,
        version: d.hello.version,
        compatible: this.compatible(d),
        maxSessions: d.status?.maxSessions ?? d.hello.maxSessions,
        sessions: {
          running: d.status?.running ?? 0,
          starting: d.status?.starting ?? 0,
        },
        resources: d.status?.resources ?? null,
        platform: d.hello.platform,
        update: d.status?.update ?? d.hello.update,
      });
    }
    return out;
  }

  /** Extra sessions an organization's connected devices can hold. */
  deviceSessionCapacity(organizationId: string): number {
    let total = 0;
    for (const d of this.devices.values()) {
      if (d.organizationId === organizationId && this.compatible(d)) {
        total += d.status?.maxSessions ?? d.hello?.maxSessions ?? 0;
      }
    }
    return total;
  }

  /** Where an organization's device-placed sessions are, and how the
   * connected ones are doing — merged into the capacity snapshot. */
  capacityOverlay(organizationId: string): {
    placements: Array<{ sessionId: string; deviceId: string }>;
    runtimeSessions: Array<DeviceSessionReport & { deviceId: string }>;
  } {
    const runtimeSessions: Array<DeviceSessionReport & { deviceId: string }> =
      [];
    for (const d of this.devices.values()) {
      if (d.organizationId !== organizationId) continue;
      for (const s of d.status?.sessions ?? d.hello?.sessions ?? []) {
        // A device's report only describes sessions the hub placed there.
        if (this.placements.get(s.sessionId)?.deviceId !== d.deviceId) continue;
        runtimeSessions.push({ ...s, deviceId: d.deviceId });
      }
    }
    return {
      placements: this.placements.forOrganization(organizationId),
      runtimeSessions,
    };
  }

  /** The organization removed the device: cut it off and forget where its
   * sessions were (their workspaces stay on the machine). */
  async disconnect(
    deviceId: string,
  ): Promise<{ disconnected: boolean; placementsDropped: number }> {
    this.revoked.set(deviceId, this.now());
    const device = this.devices.get(deviceId);
    if (device) {
      device.transport.close(TUNNEL_CLOSE.REVOKED, 'device removed');
      device.endpoint.close();
      this.devices.delete(deviceId);
    }
    const placementsDropped = await this.placements.deleteDevice(deviceId);
    return { disconnected: device !== undefined, placementsDropped };
  }

  private compatible(d: ConnectedDevice): boolean {
    return (
      d.hello !== null && versionsCompatible(this.opts.version, d.hello.version)
    );
  }

  private freeSlots(d: ConnectedDevice): number {
    if (d.hello === null) return 0;
    const max = d.status?.maxSessions ?? d.hello.maxSessions;
    const used = d.status
      ? d.status.running + d.status.starting
      : d.hello.sessions.filter((s) => s.state !== 'stopped').length;
    return max - used - d.inflightCreates;
  }

  private async routeCreate(
    req: Request,
    url: URL,
    body: string,
  ): Promise<Response | null> {
    const create = readCreate(body);
    // Malformed bodies are the local handler's 400 to give.
    if (create === null) return null;
    const existing = this.placements.get(create.sessionId);
    if (existing !== undefined) {
      if (existing.organizationId !== create.organizationId) {
        // Never 409: the platform reads that as "it exists, acquire it".
        return jsonResponse({ error: 'placement_conflict' }, 403);
      }
      this.countCreate(create.sessionId);
      return this.forward(existing.deviceId, req, url, body);
    }
    if (create.placement !== 'device') return null;
    if (await this.opts.isLocalSession(create.sessionId)) return null;
    const now = this.now();
    const candidates = [...this.devices.values()]
      .filter(
        (d) =>
          d.organizationId === create.organizationId &&
          this.compatible(d) &&
          now >= d.createFailedUntilMs &&
          this.freeSlots(d) > 0,
      )
      .sort((a, b) => this.freeSlots(b) - this.freeSlots(a));
    for (const device of candidates) {
      await this.placements.set(create.sessionId, {
        deviceId: device.deviceId,
        organizationId: create.organizationId,
        placedAtMs: this.now(),
      });
      this.countCreate(create.sessionId);
      device.inflightCreates++;
      let res: Response;
      try {
        res = await this.forward(device.deviceId, req, url, body);
      } finally {
        device.inflightCreates--;
      }
      // The platform gave up on this create (its timeout, a restarting
      // worker): nobody reads the answer, and the device may still finish
      // it. Keep the placement, so a retried create for the id lands on that
      // copy — and make no second copy elsewhere.
      if (req.signal.aborted) {
        await discard(res);
        return jsonResponse({ error: 'cancelled' }, 499);
      }
      // Full after all (its last STATUS was stale), draining, broken (its
      // Docker could not start the session, rolled back: a 5xx) or cut off
      // before answering: nothing usable was created there, so the placement
      // is released and the next place tried — a new session never fails
      // for a device it never needed. A device that failed outright sits out
      // new creates for a while. (A create cut off mid-flight may still have
      // started there; nothing routes to that copy, which stays unused.)
      if (res.status === 429 || res.status >= 500) {
        await this.placements.delete(create.sessionId);
        if (res.status !== 503) {
          device.createFailedUntilMs = this.now() + CREATE_FAILURE_COOLDOWN_MS;
        }
        await discard(res);
        continue;
      }
      // Refused as sent (a malformed create): nothing was made there either.
      // A 409 means the device holds the session already — it stays placed.
      if (!res.ok && res.status !== 409) {
        await this.placements.delete(create.sessionId);
      }
      return res;
    }
    return null;
  }

  private countCreate(sessionId: string): void {
    this.creates.set(sessionId, (this.creates.get(sessionId) ?? 0) + 1);
  }

  private async afterDestroy(
    sessionId: string,
    res: Response,
    createsBefore: number,
  ): Promise<Response> {
    if (!res.ok) return res;
    const text = await res.text();
    let busy = false;
    try {
      const parsed: unknown = JSON.parse(text);
      busy =
        parsed !== null &&
        typeof parsed === 'object' &&
        Reflect.get(parsed, 'busy') === true;
    } catch (err) {
      console.warn('[sandbox.devices] unreadable destroy answer:', err);
      busy = true;
    }
    // `?if_idle=1` on a busy session destroyed nothing; anything else leaves
    // no workspace behind on the device — unless a create for the same id
    // was forwarded while the destroy ran, which made the session anew there.
    const recreated = (this.creates.get(sessionId) ?? 0) !== createsBefore;
    if (!busy && !recreated) {
      await this.placements.delete(sessionId);
      this.creates.delete(sessionId);
    }
    return new Response(text, { status: res.status, headers: res.headers });
  }

  private async forward(
    deviceId: string,
    req: Request,
    url: URL,
    body: string,
  ): Promise<Response> {
    const device = this.devices.get(deviceId);
    if (device === undefined || device.hello === null) return offline(deviceId);
    const headers: Array<[string, string]> = [];
    for (const name of ['content-type', 'accept', 'last-event-id']) {
      const value = req.headers.get(name);
      if (value !== null) headers.push([name, value]);
    }
    try {
      const res = await device.endpoint.request(
        { method: req.method, path: url.pathname + url.search, headers },
        body === '' ? null : body,
        req.signal,
      );
      const out = toHeaders(forwardableHeaders(res.headers));
      out.set(DEVICE_HEADER, deviceId);
      return new Response(res.body, { status: res.status, headers: out });
    } catch (err) {
      if (err instanceof TunnelBusyError) {
        return jsonResponse({ error: 'device_busy', deviceId }, 503, {
          'retry-after': '5',
          [DEVICE_HEADER]: deviceId,
        });
      }
      console.warn(
        `[sandbox.devices] forwarding ${req.method} ${url.pathname} to device ${deviceId} failed:`,
        err instanceof Error ? err.message : err,
      );
      return offline(deviceId);
    }
  }

  private control(
    device: ConnectedDevice,
    type: ControlFrameType,
    payload: Record<string, unknown>,
  ): void {
    if (this.devices.get(device.deviceId) !== device) return;
    switch (type) {
      case FRAME.HELLO: {
        // Once per connection: a device announces itself, then reports.
        if (device.hello !== null) {
          device.transport.close(
            TUNNEL_CLOSE.PROTOCOL_ERROR,
            'HELLO was already received',
          );
          device.endpoint.close();
          return;
        }
        const hello = parseHello(payload);
        if (hello === null || hello.protocol !== TUNNEL_PROTOCOL_VERSION) {
          device.transport.close(
            TUNNEL_CLOSE.PROTOCOL_ERROR,
            hello === null
              ? 'malformed HELLO'
              : `unsupported tunnel protocol ${hello.protocol}`,
          );
          device.endpoint.close();
          return;
        }
        device.hello = hello;
        device.endpoint.sendControl(FRAME.WELCOME, {
          protocol: TUNNEL_PROTOCOL_VERSION,
          hubVersion: this.opts.version,
          deviceId: device.deviceId,
          organizationId: device.organizationId,
          statusIntervalMs: STATUS_INTERVAL_MS,
        });
        if (!versionsCompatible(this.opts.version, hello.version)) {
          console.warn(
            `[sandbox.devices] device ${device.deviceId} runs ${hello.version}, hub ${this.opts.version}: no new sessions until it updates`,
          );
        }
        return;
      }
      case FRAME.STATUS: {
        const status = parseStatus(payload);
        if (status === null) return;
        device.status = status;
        device.endpoint.sendControl(FRAME.STATUS_ACK, {});
        return;
      }
      case FRAME.RENEW: {
        const ticket =
          typeof payload.ticket === 'string'
            ? verifyDeviceTicket(payload.ticket, this.opts.token, this.now())
            : null;
        if (
          ticket === null ||
          !ticket.ok ||
          ticket.ticket.deviceId !== device.deviceId ||
          ticket.ticket.organizationId !== device.organizationId
        ) {
          device.transport.close(
            TUNNEL_CLOSE.REVOKED,
            'ticket renewal refused',
          );
          device.endpoint.close();
          return;
        }
        device.ticketExpiresAtMs = ticket.ticket.expiresAtMs;
        return;
      }
      default:
        return;
    }
  }

  private async relay(
    device: ConnectedDevice,
    stream: IncomingStream,
  ): Promise<void> {
    const { relay, method, path } = stream.head;
    const upstream = isRelayName(relay) ? this.opts.relays[relay] : undefined;
    if (!isRelayName(relay) || upstream === undefined) {
      stream.respond(
        { status: 502, headers: [['content-type', 'application/json']] },
        new Response(JSON.stringify({ error: 'relay_unavailable' })).body,
      );
      return;
    }
    const target = relayPath(relay, path);
    if (target === null || !relayMethodAllowed(method)) {
      stream.respond(
        { status: 403, headers: [['content-type', 'application/json']] },
        new Response(JSON.stringify({ error: 'relay_path_forbidden' })).body,
      );
      return;
    }
    const headers = toHeaders(relayRequestHeaders(stream.head.headers));
    headers.set(DEVICE_HEADER, device.deviceId);
    const hasBody = method !== 'GET' && method !== 'HEAD';
    try {
      // The canonical path, never the raw one: the check above judged it.
      const res = await this.fetchImpl(
        `${upstream.replace(/\/$/, '')}${target}`,
        {
          method,
          headers,
          ...(hasBody ? { body: stream.body, duplex: 'half' } : {}),
          signal: stream.signal,
          redirect: 'manual',
          // The session gets the upstream's bytes as sent: decompressing
          // here would leave them labelled with an encoding they lost.
          decompress: false,
          // An upstream may answer before reading a streamed body; a
          // connection left half-written must never carry the next call.
          keepalive: false,
        },
      );
      stream.respond(
        { status: res.status, headers: forwardableHeaders(res.headers) },
        res.body,
      );
    } catch (err) {
      if (stream.signal.aborted) return;
      console.warn(
        `[sandbox.devices] relay ${relay} ${method} ${path.split('?', 1)[0]} for device ${device.deviceId} failed:`,
        err instanceof Error ? err.message : err,
      );
      stream.respond(
        { status: 502, headers: [['content-type', 'application/json']] },
        new Response(JSON.stringify({ error: 'relay_failed' })).body,
      );
    }
  }

  private closeStale(): void {
    const now = this.now();
    for (const [deviceId, at] of this.revoked) {
      if (now - at > REVOCATION_MEMORY_MS) this.revoked.delete(deviceId);
    }
    // Create counts only matter while a placement (and so a destroy) can.
    for (const sessionId of this.creates.keys()) {
      if (this.placements.get(sessionId) === undefined) {
        this.creates.delete(sessionId);
      }
    }
    // Deleting the current entry while iterating a Map is safe.
    for (const device of this.devices.values()) {
      const expired = now >= device.ticketExpiresAtMs;
      const silent = now - device.lastMessageAtMs > STATUS_INTERVAL_MS * 3;
      if (!expired && !silent) continue;
      device.transport.close(
        TUNNEL_CLOSE.TICKET_EXPIRED,
        expired ? 'ticket expired' : 'no status from the device',
      );
      device.endpoint.close();
      this.devices.delete(device.deviceId);
    }
  }
}

/** Run the hub's WebSocket door on its own port. Only the upgrade and a
 * health probe answer here. */
export function serveHub(
  hub: DeviceHub,
  port: number,
): ReturnType<typeof Bun.serve> {
  interface SocketData {
    ticket: DeviceTicket;
    connection: DeviceConnection | null;
  }
  return Bun.serve<SocketData>({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/health') {
        return jsonResponse({ status: 'ok' }, 200);
      }
      if (url.pathname !== TUNNEL_PATH) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      const ticket = hub.authenticate(req);
      if (ticket === null) return jsonResponse({ error: 'unauthorized' }, 401);
      if (server.upgrade(req, { data: { ticket, connection: null } })) {
        return undefined;
      }
      return jsonResponse({ error: 'websocket_upgrade_required' }, 426);
    },
    websocket: {
      maxPayloadLength: 1024 * 1024,
      // The device reports every 15 s; a socket silent for a minute is dead.
      idleTimeout: 60,
      sendPings: true,
      open(ws) {
        ws.data.connection = hub.attach(ws.data.ticket, {
          send: (frame) => {
            if (ws.send(frame) === 0)
              throw new Error('socket dropped the frame');
          },
          bufferedAmount: () => ws.getBufferedAmount(),
          close: (code, reason) => ws.close(code, reason),
        });
      },
      message(ws, message) {
        if (typeof message === 'string') {
          ws.close(
            TUNNEL_CLOSE.PROTOCOL_ERROR,
            'text frames are not part of the tunnel',
          );
          return;
        }
        ws.data.connection?.receive(
          new Uint8Array(
            message.buffer,
            message.byteOffset,
            message.byteLength,
          ),
        );
      },
      drain(ws) {
        ws.data.connection?.drained();
      },
      close(ws) {
        ws.data.connection?.closed();
      },
    },
  });
}
