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

import { memoryReserveBytes, sessionWorkingSetBytes } from '../host-memory.ts';
import { jsonResponse } from '../http-util.ts';
import { ID_ALPHABET_RE, ORG_ID_ALPHABET_RE } from '../wire.ts';
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
import { PlacementStore, type Placement } from './placements.ts';
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
/** How long the hub waits before asking a device again whether a destroyed
 * session's bytes are gone: the route to them stays until it says so. */
const DELETING_RECHECK_MS = 5 * 60_000;
/** Destroyed sessions asked about per sweep at most: a backlog is worked off
 * over a few sweeps instead of in one burst. */
const DELETING_RECHECKS_PER_SWEEP = 8;
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
  /** How often the hub sweeps (tickets, silent devices, deleting
   * placements); tests shorten it. */
  sweepIntervalMs?: number;
}

/** A relay fetch's options: Bun's `decompress: false` keeps the upstream's
 * bytes (and its `content-encoding`) exactly as they came. */
export type RelayFetchInit = RequestInit & { decompress?: boolean };

interface ForwardAttempt {
  response: Response;
  /** Set only by this hub before a request can reach the device. */
  notSent: boolean;
}

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
  if (
    typeof sessionId !== 'string' ||
    !ID_ALPHABET_RE.test(sessionId) ||
    typeof organizationId !== 'string' ||
    !ORG_ID_ALPHABET_RE.test(organizationId)
  ) {
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
  /** Unique create generations: clearing a finished session cannot reuse the
   * identity captured by a delayed destroy of an earlier incarnation. */
  private readonly creates = new Map<string, symbol>();
  /** Creates and destroy finalization share one ordering per id: no create
   * may reuse a route while its durable deletion is still committing. */
  private readonly placing = new Map<string, Promise<void>>();
  /** When the hub last asked a device about a destroyed session's bytes. In
   * memory: after a restart it asks again at once. */
  private readonly deletingAskedAtMs = new Map<string, number>();
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
    this.sweep = setInterval(() => {
      this.closeStale();
      void this.recheckDeleting();
    }, this.opts.sweepIntervalMs ?? TICKET_SWEEP_MS);
  }

  /**
   * Ask the devices again about the destroyed sessions whose bytes they
   * were still deleting — whoever destroyed them, and whether or not anyone
   * will ask for the id again (a run's reclaim never does). The question is
   * the platform cleanup's own conditional destroy: on a device with no
   * session under the id it only reads its trash and has what is left
   * attempted again, and while a create or compute is under the id it
   * answers busy and touches nothing. `afterDestroy` then lets the route go
   * on `done` and keeps it on anything else, so a route lasts exactly as
   * long as the bytes it leads to.
   */
  async recheckDeleting(): Promise<void> {
    const now = this.now();
    for (const sessionId of this.deletingAskedAtMs.keys()) {
      if (this.placements.get(sessionId)?.deleting !== true) {
        this.deletingAskedAtMs.delete(sessionId);
      }
    }
    // Least recently asked first, never asked before all: however many
    // stay unresolved, every one is asked in its turn.
    const askedAt = (sessionId: string) =>
      this.deletingAskedAtMs.get(sessionId) ?? Number.NEGATIVE_INFINITY;
    const due = this.placements
      .deleting()
      .filter(({ sessionId, deviceId }) => {
        const device = this.devices.get(deviceId);
        return (
          device !== undefined &&
          this.compatible(device) &&
          now - askedAt(sessionId) >= DELETING_RECHECK_MS
        );
      })
      .sort((a, b) => askedAt(a.sessionId) - askedAt(b.sessionId))
      .slice(0, DELETING_RECHECKS_PER_SWEEP);
    for (const { sessionId } of due) this.deletingAskedAtMs.set(sessionId, now);
    await Promise.all(due.map(({ sessionId }) => this.askDeleting(sessionId)));
  }

  private async askDeleting(sessionId: string): Promise<void> {
    const url = new URL(
      `http://sandbox/v1/sessions/${sessionId}?if_idle=1&if_stopped=1&await_deletion=1`,
    );
    try {
      const res = await this.maybeForward(
        new Request(url.toString(), { method: 'DELETE' }),
        url,
        '',
      );
      await res?.text();
    } catch (err) {
      console.warn(
        `[sandbox.devices] asking again whether ${sessionId}'s bytes are gone failed:`,
        err,
      );
    }
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
      const create = readCreate(body);
      if (create === null) return null;
      return this.withPlacement(create.sessionId, () =>
        this.routeCreate(req, url, body),
      );
    }
    const sessionId = sessionIdFromPath(url.pathname);
    if (sessionId === null) return null;
    const placement = this.placements.get(sessionId);
    if (placement === undefined) return null;
    const createsBefore = this.creates.get(sessionId);
    const res = await this.forward(placement.deviceId, req, url, body);
    if (
      req.method === 'DELETE' &&
      url.pathname === `/v1/sessions/${sessionId}`
    ) {
      return this.afterDestroy(sessionId, res, createsBefore, placement);
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
        // A device's report only describes sessions the hub placed there —
        // not one destroyed since, whose bytes alone it still deletes.
        const placement = this.placements.get(s.sessionId);
        if (placement?.deviceId !== d.deviceId || placement.deleting === true) {
          continue;
        }
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
    const slots = max - used - d.inflightCreates;
    const memory = d.status?.resources.memory;
    if (
      memory === undefined ||
      memory.totalBytes === null ||
      memory.usedBytes === null ||
      memory.totalBytes <= 0 ||
      memory.usedBytes > memory.totalBytes
    )
      return slots;
    // Devices run non-DinD sessions. This is a placement hint from the last
    // report; the device's current local admission remains authoritative.
    const available =
      memory.totalBytes -
      memory.usedBytes -
      memoryReserveBytes(memory.totalBytes);
    const memorySlots = Math.floor(
      available / sessionWorkingSetBytes('agent', false),
    );
    return Math.min(slots, memorySlots - d.inflightCreates);
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
      if (existing.deleting !== true) {
        this.noteCreate(create.sessionId);
        return this.forward(existing.deviceId, req, url, body);
      }
    }
    // A destroyed session whose bytes a device is still deleting: a fresh
    // session under the id is placed like any other — with every fallback a
    // create has — but tries that device first, which keeps one place
    // answering for both. Placed anywhere else, the route to the old bytes
    // is let go: a new session never fails for an old workspace's bytes.
    const deletingOn = existing?.deviceId;
    const placed = await this.placeCreate(req, url, body, create, deletingOn);
    if (placed === null && deletingOn !== undefined) {
      await this.placements.delete(create.sessionId);
    }
    return placed;
  }

  /** Place a create on one of its organization's devices with room — most
   * room first, `preferred` before all — and fall back on the next one,
   * then on the server (`null`). */
  private async placeCreate(
    req: Request,
    url: URL,
    body: string,
    create: NonNullable<ReturnType<typeof readCreate>>,
    preferred: string | undefined,
  ): Promise<Response | null> {
    if (create.placement !== 'device') return null;
    if (await this.opts.isLocalSession(create.sessionId)) return null;
    const eligible = (device: ConnectedDevice) =>
      this.devices.get(device.deviceId) === device &&
      device.organizationId === create.organizationId &&
      this.compatible(device) &&
      this.now() >= device.createFailedUntilMs &&
      this.freeSlots(device) > 0;
    const candidates = [...this.devices.values()]
      .filter(eligible)
      .sort(
        (a, b) =>
          Number(b.deviceId === preferred) - Number(a.deviceId === preferred) ||
          this.freeSlots(b) - this.freeSlots(a),
      );
    for (const device of candidates) {
      // An earlier candidate's refusal may have taken seconds; another
      // create can have reserved this device, or it may have been replaced
      // or removed. A stale candidate cannot authorize a new placement.
      if (!eligible(device)) continue;
      // Fence destroys already dispatched; finalization also compares the
      // published placement for an ask dispatched during this durable write.
      this.noteCreate(create.sessionId);
      // Reserve before the durable write yields, so a burst cannot all
      // select the same device using its last free slot.
      device.inflightCreates++;
      let attempt: ForwardAttempt;
      try {
        await this.placements.set(create.sessionId, {
          deviceId: device.deviceId,
          organizationId: create.organizationId,
          placedAtMs: this.now(),
        });
        attempt = await this.forwardAttempt(
          device.deviceId,
          req,
          url,
          body,
          device,
        );
      } finally {
        device.inflightCreates--;
      }
      const res = attempt.response;
      // The platform gave up on this create (its timeout, a restarting
      // worker): nobody reads the answer, and the device may still finish
      // it. Keep the placement, so a retried create for the id lands on that
      // copy — and make no second copy elsewhere.
      if (req.signal.aborted) {
        await discard(res);
        return jsonResponse({ error: 'cancelled' }, 499);
      }
      // Admission's 429 or the hub's own pre-send refusal confirms nothing
      // started. Remote 5xx and lost answers do not; a retry must reconcile
      // with that workspace instead of creating another copy.
      if (attempt.notSent || res.status === 429) {
        await this.placements.delete(create.sessionId);
        device.createFailedUntilMs = this.now() + CREATE_FAILURE_COOLDOWN_MS;
        await discard(res);
        continue;
      }
      if (res.status >= 500) {
        device.createFailedUntilMs = this.now() + CREATE_FAILURE_COOLDOWN_MS;
        return res;
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

  private noteCreate(sessionId: string): void {
    this.creates.set(sessionId, Symbol());
  }

  private async withPlacement<T>(
    sessionId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const prior = this.placing.get(sessionId) ?? Promise.resolve();
    const work = prior.then(action);
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.placing.set(sessionId, settled);
    try {
      return await work;
    } finally {
      if (this.placing.get(sessionId) === settled)
        this.placing.delete(sessionId);
    }
  }

  private async afterDestroy(
    sessionId: string,
    res: Response,
    createsBefore: symbol | undefined,
    placementBefore: Placement,
  ): Promise<Response> {
    if (!res.ok) return res;
    const text = await res.text();
    let busy = false;
    let deleted = false;
    let kept = false;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') {
        busy = Reflect.get(parsed, 'busy') === true;
        const deletion: unknown = Reflect.get(parsed, 'deletion');
        deleted = deletion === 'done' || deletion === 'handed_off';
        kept = Reflect.get(parsed, 'workspaceKept') === true;
      }
    } catch (err) {
      console.warn('[sandbox.devices] unreadable destroy answer:', err);
      busy = true;
    }
    // `?if_idle=1` on a busy session destroyed nothing, and a create for the
    // same id forwarded while the destroy ran made the session anew there:
    // the placement stays as it is. So does a stop that kept the workspace
    // (`?keep_workspace=1`): the device still holds it for the id's next
    // session. Otherwise no session lives on the device any more, but its
    // workspace's bytes may: only an explicit completion lets go of the
    // route. A device still deleting (`pending`, `failed`) —
    // or one older than the `deletion` contract, whose answer says nothing
    // about the bytes — keeps it, marked deleting, so the destroy that asks
    // again reaches the device holding them.
    await this.withPlacement(sessionId, async () => {
      // A create can already have its generation when a destroy captures
      // the still-visible deleting route during its durable write. Compare
      // the immutable published placement too, after that create settles.
      const recreated =
        this.creates.get(sessionId) !== createsBefore ||
        this.placements.get(sessionId) !== placementBefore;
      if (!busy && !kept && !recreated) {
        if (deleted) {
          await this.placements.delete(sessionId);
          this.creates.delete(sessionId);
        } else {
          await this.placements.markDeleting(sessionId);
        }
      }
    });
    return new Response(text, { status: res.status, headers: res.headers });
  }

  private async forward(
    deviceId: string,
    req: Request,
    url: URL,
    body: string,
  ): Promise<Response> {
    return (await this.forwardAttempt(deviceId, req, url, body)).response;
  }

  private async forwardAttempt(
    deviceId: string,
    req: Request,
    url: URL,
    body: string,
    expectedDevice?: ConnectedDevice,
  ): Promise<ForwardAttempt> {
    const device = this.devices.get(deviceId);
    if (
      device === undefined ||
      device.hello === null ||
      (expectedDevice !== undefined &&
        (device !== expectedDevice || !this.compatible(device)))
    )
      return { response: offline(deviceId), notSent: true };
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
      return {
        response: new Response(res.body, { status: res.status, headers: out }),
        notSent: false,
      };
    } catch (err) {
      if (err instanceof TunnelBusyError) {
        return {
          response: jsonResponse({ error: 'device_busy', deviceId }, 503, {
            'retry-after': '5',
            [DEVICE_HEADER]: deviceId,
          }),
          notSent: true,
        };
      }
      console.warn(
        `[sandbox.devices] forwarding ${req.method} ${url.pathname} to device ${deviceId} failed:`,
        err instanceof Error ? err.message : err,
      );
      return { response: offline(deviceId), notSent: false };
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
