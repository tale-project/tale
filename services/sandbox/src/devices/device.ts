// Device mode — the spawner on a machine an organization connected. It keeps
// ONE outbound WebSocket to the hub (the deployment's spawner), so the
// machine needs nothing but outbound HTTPS to the Tale site:
//
//   1. mint a connect ticket from the platform with the device secret
//      (`POST /api/sandbox-devices/ticket`) — the platform checks the secret
//      against its registry, so a removed device gets no ticket;
//   2. dial `wss://<site>/sandbox/tunnel` with it, announce itself (HELLO),
//      report what it runs every few seconds (STATUS) and renew the ticket
//      before it expires (RENEW);
//   3. serve the session calls the hub forwards — in-process, through the
//      same handlers the spawner's HTTP API uses;
//   4. answer its sessions' calls to `backend-api` / `sandbox-llm-gateway`
//      (the relay listeners) by relaying them through the tunnel;
//   5. follow the server's release: when the ticket answer names a newer
//      release, launch the updater (apply.ts) and let it replace this process.
//
// A dropped connection is retried with capped, jittered backoff; running
// sessions keep running meanwhile — only calls into them wait.

import {
  handleSandboxRequest,
  reportSandboxError,
  sandboxServerError,
} from '../error-reporting.ts';
import { jsonResponse, sessionRequestBodyLimit } from '../http-util.ts';
import { runDocker } from '../spawn-util.ts';
import { readUpdateStatus, type DeviceConfig } from './device-config.ts';
import {
  isReleaseVersion,
  parseWelcome,
  type DevicePlatform,
  type DeviceResources,
  type DeviceUpdateReport,
  type DeviceSessionReport,
} from './messages.ts';
import {
  forwardableHeaders,
  relayEndpoint,
  toHeaders,
  type RelayName,
} from './relay-policy.ts';
import {
  FRAME,
  TUNNEL_CLOSE,
  TUNNEL_PROTOCOL_VERSION,
  TunnelEndpoint,
  type IncomingStream,
  type TunnelTransport,
} from './tunnel.ts';

const RENEW_EVERY_MS = 5 * 60_000;
const DEFAULT_STATUS_INTERVAL_MS = 15_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** A connection that lived this long resets the backoff. */
const STABLE_CONNECTION_MS = 60_000;
/** Between two self-update attempts at the same target. */
const UPDATE_RETRY_MS = 30 * 60_000;
/** An update still "updating" after this long did not finish. */
const UPDATE_STALE_MS = 30 * 60_000;
const REVOKED_RECHECK_MS = 60 * 60_000;
/** A hub that has not answered the WebSocket upgrade by then never will (a
 * proxy can accept the connection and sit on it): dial again. */
const CONNECT_TIMEOUT_MS = 30_000;

const NOTHING_OBSERVED: DeviceObservation = {
  running: 0,
  starting: 0,
  sessions: [],
  resources: {
    cpu: { totalCores: null, usedCores: null },
    memory: { totalBytes: null, usedBytes: null },
  },
};

/**
 * The update report as it stands for THIS spawner: an update whose target is
 * the release running here landed (its helper may have died before saying
 * so), and one "updating" for longer than any update takes did not finish.
 */
export function effectiveUpdate(
  report: DeviceUpdateReport,
  ownVersion: string,
  nowMs: number,
): DeviceUpdateReport {
  if (report.state !== 'updating') return report;
  if (report.targetVersion === ownVersion) {
    return { ...report, state: 'idle', error: null };
  }
  if (report.atMs !== null && nowMs - report.atMs > UPDATE_STALE_MS) {
    return {
      ...report,
      state: 'failed',
      error: `The update to ${report.targetVersion ?? 'the new release'} did not finish.`,
    };
  }
  return report;
}

/** The platform no longer knows this device (removed in Settings, or the
 * secret was never valid). Nothing to retry until someone reconnects it. */
export class DeviceRevokedError extends Error {
  constructor(status: number) {
    super(
      `the Tale server refused this device's credential (${status}) — it was removed from its organization. Run \`tale sandbox disconnect\` on this machine, then connect it again with a new command from Settings → Sandboxes.`,
    );
    this.name = 'DeviceRevokedError';
  }
}

/** What the platform answers `POST /api/sandbox-devices/ticket`. */
export interface TicketGrant {
  ticket: string;
  tunnelUrl: string;
  serverVersion: string;
}

/** The part of a WebSocket the agent uses — Bun's client in production. */
export interface WebSocketLike {
  binaryType: string;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: 'close',
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export interface DeviceObservation {
  running: number;
  starting: number;
  sessions: DeviceSessionReport[];
  resources: DeviceResources;
}

export interface DeviceAgentOptions {
  config: DeviceConfig;
  /** This spawner's release (TALE_VERSION). */
  version: string;
  maxRequestBodyBytes: number;
  /** Serve a forwarded session call in-process (routing, no signature — the
   * tunnel's peer is the authenticated hub). */
  dispatch: (req: Request, url: URL, body: string) => Promise<Response>;
  /** What this device runs right now. */
  observe: () => Promise<DeviceObservation>;
  /** Launch the helper that moves the device to `version`. */
  selfUpdate: (version: string) => Promise<void>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  connect?: (url: string, ticket: string) => WebSocketLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  platform?: () => Promise<DevicePlatform>;
  /** How long an unanswered upgrade is waited for (tests shorten it). */
  connectTimeoutMs?: number;
}

function defaultConnect(url: string, ticket: string): WebSocketLike {
  // Bun's client takes request headers — the ticket rides `Authorization`
  // like any bearer credential, so proxies in front of the hub pass it.
  return new WebSocket(url, {
    headers: { authorization: `Bearer ${ticket}` },
  });
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('payload too large');
      throw new Error('payload_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  return null;
}

/** Docker's view of this machine plus what the CLI recorded about its host. */
async function observePlatform(config: DeviceConfig): Promise<DevicePlatform> {
  const info = await runDocker(
    [
      'info',
      '--format',
      '{{json .NCPU}}|{{json .MemTotal}}|{{json .ServerVersion}}',
    ],
    { timeoutMs: 10_000 },
  );
  let cpus: number | null = null;
  let memoryBytes: number | null = null;
  let dockerVersion: string | null = null;
  if (info.exitCode === 0) {
    const [ncpu, mem, version] = info.stdout.trim().split('|');
    const parse = (raw: string | undefined): unknown => {
      try {
        return raw === undefined ? null : JSON.parse(raw);
      } catch (err) {
        console.warn('[sandbox.devices] unreadable docker info field:', err);
        return null;
      }
    };
    const n = parse(ncpu);
    const m = parse(mem);
    const v = parse(version);
    cpus = typeof n === 'number' && n > 0 ? n : null;
    memoryBytes = typeof m === 'number' && m > 0 ? m : null;
    dockerVersion = typeof v === 'string' ? v.slice(0, 64) : null;
  } else {
    console.warn(`[sandbox.devices] docker info failed: ${info.stderr.trim()}`);
  }
  return {
    os: config.host.os,
    arch: config.host.arch,
    cpus,
    memoryBytes,
    dockerVersion,
  };
}

export class DeviceAgent {
  private readonly fetchImpl: (
    input: string,
    init: RequestInit,
  ) => Promise<Response>;
  private readonly connectImpl: (url: string, ticket: string) => WebSocketLike;
  private readonly now: () => number;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly platformImpl: () => Promise<DevicePlatform>;
  private endpoint: TunnelEndpoint | null = null;
  private welcomed = false;
  private stopped = false;
  private socket: WebSocketLike | null = null;
  private relayServers: Array<ReturnType<typeof Bun.serve>> = [];
  private lastUpdateAttempt: { version: string; atMs: number } | null = null;
  /** The last observation that worked: reported while Docker is slow, so a
   * busy daemon never costs the tunnel (and every stream riding it). */
  private lastObservation: DeviceObservation = NOTHING_OBSERVED;
  private wakeSleep: (() => void) | null = null;
  private platformCache: DevicePlatform | null = null;

  constructor(private readonly opts: DeviceAgentOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.connectImpl = opts.connect ?? defaultConnect;
    this.now = opts.now ?? Date.now;
    this.sleepImpl =
      opts.sleep ??
      ((ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          this.wakeSleep = () => {
            clearTimeout(timer);
            resolve();
          };
        }));
    this.platformImpl = opts.platform ?? (() => observePlatform(opts.config));
  }

  /** Is the tunnel up and welcomed right now? */
  get connected(): boolean {
    return this.welcomed && this.endpoint !== null && !this.endpoint.closed;
  }

  /** Start the relay listeners and the connection loop (runs until stop). */
  start(): Promise<void> {
    this.startRelays();
    return this.run();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close(TUNNEL_CLOSE.GOING_AWAY, 'device shutting down');
    this.wakeSleep?.();
    for (const server of this.relayServers) {
      void server.stop(true);
    }
    this.relayServers = [];
  }

  private async run(): Promise<void> {
    let backoffMs = MIN_BACKOFF_MS;
    let lastRevokedLog = 0;
    while (!this.stopped) {
      let connectedMs = 0;
      try {
        const grant = await this.mintTicket();
        this.considerUpdate(grant.serverVersion);
        connectedMs = await this.runConnection(grant);
      } catch (err) {
        if (err instanceof DeviceRevokedError) {
          if (this.now() - lastRevokedLog >= REVOKED_RECHECK_MS) {
            console.error(`[sandbox.devices] ${err.message}`);
            lastRevokedLog = this.now();
          }
          await this.sleepImpl(REVOKED_RECHECK_MS);
          continue;
        }
        console.warn(
          '[sandbox.devices] connecting to the Tale server failed:',
          err instanceof Error ? err.message : err,
        );
      }
      if (this.stopped) break;
      if (connectedMs >= STABLE_CONNECTION_MS) backoffMs = MIN_BACKOFF_MS;
      await this.sleepImpl(Math.round(backoffMs * (0.5 + Math.random() / 2)));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  private async platform(): Promise<DevicePlatform> {
    this.platformCache ??= await this.platformImpl();
    return this.platformCache;
  }

  /** Exchange the device secret for a short-lived connect ticket. */
  async mintTicket(): Promise<TicketGrant> {
    const { config } = this.opts;
    const res = await this.fetchImpl(
      `${config.serverUrl}/api/sandbox-devices/ticket`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.deviceSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: this.opts.version,
          maxSessions: config.maxSessions,
          platform: await this.platform(),
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      // Only the platform's own answer means the organization removed this
      // device. A proxy, firewall or development server refusing the request
      // (403 "host not allowed", a 401 from an auth gate in front of Tale)
      // is a reachability problem: retried with backoff, reason logged.
      if (res.status === 401 && text.includes('DEVICE_REVOKED')) {
        throw new DeviceRevokedError(res.status);
      }
      throw new Error(
        `ticket request answered ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    const body: unknown = await res.json();
    const field = (key: string): unknown =>
      body !== null && typeof body === 'object'
        ? Reflect.get(body, key)
        : undefined;
    const ticket = field('ticket');
    const tunnelUrl = field('tunnelUrl');
    const serverVersion = field('serverVersion');
    if (
      typeof ticket !== 'string' ||
      typeof tunnelUrl !== 'string' ||
      !/^wss?:\/\//.test(tunnelUrl)
    ) {
      throw new Error('ticket answer is missing its ticket or tunnel URL');
    }
    return {
      ticket,
      tunnelUrl,
      serverVersion: typeof serverVersion === 'string' ? serverVersion : '',
    };
  }

  /** Follow the server's release. Local builds (no release version on
   * either side) are left alone — that is a development setup. */
  private considerUpdate(serverVersion: string): void {
    const own = this.opts.version;
    if (
      !this.opts.config.autoUpdate ||
      !isReleaseVersion(serverVersion) ||
      !isReleaseVersion(own) ||
      serverVersion === own
    ) {
      return;
    }
    const last = this.lastUpdateAttempt;
    if (
      last !== null &&
      last.version === serverVersion &&
      this.now() - last.atMs < UPDATE_RETRY_MS
    ) {
      return;
    }
    this.lastUpdateAttempt = { version: serverVersion, atMs: this.now() };
    console.log(
      `[sandbox.devices] the server runs ${serverVersion} (this device ${own}); updating`,
    );
    this.opts.selfUpdate(serverVersion).catch((err: unknown) => {
      console.error('[sandbox.devices] launching the update failed:', err);
      reportSandboxError(err, 'device-update');
    });
  }

  private runConnection(grant: TicketGrant): Promise<number> {
    return new Promise<number>((resolveConnection) => {
      let settled = false;
      const resolve = (connectedMs: number): void => {
        if (settled) return;
        settled = true;
        resolveConnection(connectedMs);
      };
      const ws = this.connectImpl(grant.tunnelUrl, grant.ticket);
      ws.binaryType = 'arraybuffer';
      this.socket = ws;
      const transport: TunnelTransport = {
        send: (frame) => ws.send(frame),
        bufferedAmount: () => ws.bufferedAmount,
        close: (code, reason) => ws.close(code, reason),
      };
      let openedAt: number | null = null;
      let lastReceived = this.now();
      let statusIntervalMs = DEFAULT_STATUS_INTERVAL_MS;
      let statusTimer: ReturnType<typeof setInterval> | null = null;
      const timers: Array<ReturnType<typeof setInterval>> = [];
      const scheduleStatus = () => {
        if (statusTimer !== null) clearInterval(statusTimer);
        statusTimer = setInterval(() => {
          void this.sendStatus(endpoint);
        }, statusIntervalMs);
      };
      const stopTimers = () => {
        if (statusTimer !== null) clearInterval(statusTimer);
        statusTimer = null;
        for (const t of timers) clearInterval(t);
        timers.length = 0;
      };
      const endpoint = new TunnelEndpoint('device', transport, {
        onStream: (stream) => {
          void this.serve(stream);
        },
        onControl: (type, payload) => {
          if (type !== FRAME.WELCOME) return;
          const welcome = parseWelcome(payload);
          if (
            welcome === null ||
            welcome.protocol !== TUNNEL_PROTOCOL_VERSION
          ) {
            ws.close(TUNNEL_CLOSE.PROTOCOL_ERROR, 'unsupported WELCOME');
            return;
          }
          if (this.endpoint !== endpoint) return;
          this.welcomed = true;
          statusIntervalMs = Math.max(5_000, welcome.statusIntervalMs);
          scheduleStatus();
          console.log(
            `[sandbox.devices] connected to the hub as device ${welcome.deviceId} (hub ${welcome.hubVersion})`,
          );
          void this.sendStatus(endpoint);
        },
      });

      // An upgrade nobody answers leaves the socket neither open nor closed
      // (and a close() then fires no event): give up on it here.
      const connectTimer = setTimeout(() => {
        if (openedAt !== null) return;
        console.warn(
          '[sandbox.devices] the hub did not answer in time; dialling again',
        );
        try {
          ws.close();
        } catch (err) {
          console.warn(
            '[sandbox.devices] closing the stalled socket failed:',
            err,
          );
        }
        stopTimers();
        endpoint.close();
        if (this.socket === ws) this.socket = null;
        resolve(0);
      }, this.opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        clearTimeout(connectTimer);
        openedAt = this.now();
        lastReceived = openedAt;
        this.endpoint = endpoint;
        void this.hello(endpoint);
        scheduleStatus();
        timers.push(
          setInterval(() => {
            void this.renew(endpoint);
          }, RENEW_EVERY_MS),
          setInterval(() => {
            if (this.now() - lastReceived > statusIntervalMs * 3) {
              ws.close(4000, 'hub went silent');
            }
          }, 5_000),
        );
      });
      ws.addEventListener('message', (event) => {
        lastReceived = this.now();
        const bytes = toBytes(event.data);
        if (bytes === null) {
          ws.close(
            TUNNEL_CLOSE.PROTOCOL_ERROR,
            'text frames are not part of the tunnel',
          );
          return;
        }
        endpoint.receive(bytes);
      });
      ws.addEventListener('error', (event) => {
        const message =
          event !== null && typeof event === 'object' && 'message' in event
            ? String(event.message)
            : 'socket error';
        console.warn(`[sandbox.devices] tunnel socket error: ${message}`);
      });
      ws.addEventListener('close', (event) => {
        clearTimeout(connectTimer);
        stopTimers();
        endpoint.close();
        if (this.endpoint === endpoint) {
          this.endpoint = null;
          this.welcomed = false;
        }
        // A socket given up on may close after its successor opened.
        if (this.socket === ws) this.socket = null;
        if (openedAt !== null) {
          console.log(
            `[sandbox.devices] disconnected from the hub (${event.code}${event.reason ? `: ${event.reason}` : ''})`,
          );
        }
        resolve(openedAt === null ? 0 : this.now() - openedAt);
      });
    });
  }

  /** What the device runs now — or, while Docker does not answer, what it
   * ran at the last observation that worked. */
  private async observation(): Promise<DeviceObservation> {
    try {
      this.lastObservation = await this.opts.observe();
    } catch (err) {
      console.warn(
        '[sandbox.devices] observing the sandboxes failed; reporting the last observation:',
        err instanceof Error ? err.message : err,
      );
    }
    return this.lastObservation;
  }

  private async updateReport(): Promise<DeviceUpdateReport> {
    return effectiveUpdate(
      await readUpdateStatus(this.opts.config.stateDir),
      this.opts.version,
      this.now(),
    );
  }

  private async hello(endpoint: TunnelEndpoint): Promise<void> {
    try {
      const [observation, platform, update] = await Promise.all([
        this.observation(),
        this.platform(),
        this.updateReport(),
      ]);
      endpoint.sendControl(FRAME.HELLO, {
        protocol: TUNNEL_PROTOCOL_VERSION,
        version: this.opts.version,
        maxSessions: this.opts.config.maxSessions,
        platform,
        sessions: observation.sessions,
        update,
      });
    } catch (err) {
      console.error('[sandbox.devices] announcing the device failed:', err);
      reportSandboxError(err, 'device-announcement');
      this.socket?.close(4000, 'hello failed');
    }
  }

  private async sendStatus(endpoint: TunnelEndpoint): Promise<void> {
    if (endpoint.closed) return;
    try {
      const [observation, update] = await Promise.all([
        this.observation(),
        this.updateReport(),
      ]);
      endpoint.sendControl(FRAME.STATUS, {
        maxSessions: this.opts.config.maxSessions,
        running: observation.running,
        starting: observation.starting,
        sessions: observation.sessions,
        resources: observation.resources,
        update,
      });
    } catch (err) {
      console.warn('[sandbox.devices] status report failed:', err);
    }
  }

  private async renew(endpoint: TunnelEndpoint): Promise<void> {
    try {
      const grant = await this.mintTicket();
      if (!endpoint.closed)
        endpoint.sendControl(FRAME.RENEW, { ticket: grant.ticket });
      this.considerUpdate(grant.serverVersion);
    } catch (err) {
      if (err instanceof DeviceRevokedError) {
        console.error(`[sandbox.devices] ${err.message}`);
        this.socket?.close(TUNNEL_CLOSE.REVOKED, 'device removed');
        return;
      }
      console.warn(
        '[sandbox.devices] renewing the connect ticket failed (the hub keeps the old one until it expires):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** A session call the hub forwarded. Only the session API is reachable
   * through the tunnel; the drain and deploy controls stay local. */
  private async serve(stream: IncomingStream): Promise<void> {
    const { method, path, relay } = stream.head;
    if (relay !== undefined || !path.startsWith('/v1/sessions')) {
      stream.reset('forbidden', 'the hub may only reach the session API');
      return;
    }
    let body: string;
    try {
      body = await readCapped(
        stream.body,
        sessionRequestBodyLimit(path, this.opts.maxRequestBodyBytes),
      );
    } catch (err) {
      stream.reset(
        'bad_request',
        err instanceof Error ? err.message : 'unreadable body',
      );
      return;
    }
    const url = new URL(path, 'http://device.invalid');
    const hasBody = method !== 'GET' && method !== 'HEAD' && body !== '';
    const req = new Request(url.toString(), {
      method,
      headers: toHeaders(stream.head.headers),
      signal: stream.signal,
      ...(hasBody ? { body } : {}),
    });
    let res: Response;
    try {
      res = await this.opts.dispatch(req, url, body);
    } catch (err) {
      console.error(
        `[sandbox.devices] serving ${method} ${url.pathname} failed:`,
        err,
      );
      reportSandboxError(err, 'device-handler', req.signal, req);
      res = jsonResponse(
        {
          error: 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
    stream.respond(
      { status: res.status, headers: forwardableHeaders(res.headers) },
      res.body,
    );
  }

  /** Answer the platform addresses (`backend-api:3005`,
   * `sandbox-llm-gateway:8080`) this device's sessions call. */
  private startRelays(): void {
    for (const relay of this.opts.config.relays) {
      const { port } = relayEndpoint(relay.url);
      try {
        this.relayServers.push(
          Bun.serve({
            port,
            hostname: '0.0.0.0',
            // LLM streams can pause while a model thinks; stay under Bun's cap.
            idleTimeout: 255,
            fetch: (req) =>
              handleSandboxRequest(req, (request) =>
                this.relayRequest(relay.name, request),
              ),
            error: sandboxServerError,
          }),
        );
      } catch (err) {
        reportSandboxError(err, 'device-relay-listener');
        console.error(
          `[sandbox.devices] cannot answer ${relay.url} for sessions (port ${port}):`,
          err,
        );
      }
    }
  }

  async relayRequest(name: RelayName, req: Request): Promise<Response> {
    const endpoint = this.endpoint;
    if (!this.connected || endpoint === null) {
      return jsonResponse(
        {
          error: 'device_offline',
          message:
            'This device is not connected to the Tale server right now; retry shortly.',
        },
        503,
        { 'retry-after': '10' },
      );
    }
    const url = new URL(req.url);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    try {
      const res = await endpoint.request(
        {
          method: req.method,
          path: url.pathname + url.search,
          headers: forwardableHeaders(req.headers),
          relay: name,
        },
        hasBody ? req.body : null,
        req.signal,
      );
      return new Response(res.body, {
        status: res.status,
        headers: toHeaders(res.headers),
      });
    } catch (err) {
      console.warn(
        `[sandbox.devices] relaying ${req.method} ${url.pathname} (${name}) failed:`,
        err instanceof Error ? err.message : err,
      );
      return jsonResponse({ error: 'relay_failed' }, 502);
    }
  }
}
