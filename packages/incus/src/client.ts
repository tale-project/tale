// The Incus REST API over fetch with mutual TLS — the door its callers open
// on the node (the sandbox spawner's Incus backend and the CLI's Incus
// runtime). There is no client library: the node's API is reached with a
// client certificate restricted to one project, and the connection is pinned
// to the node's own server certificate. The one exception is a single box's
// bootstrap, which talks to the local Unix socket (`unix-transport.ts`).
//
// This module is the transport and the calls the spawner makes. The calls
// of a whole stack live in modules of their own over `send`, `sync`,
// `operation`, `startOperation` and `openWebSocket` (exec, exec-session,
// files, volumes, snapshots, state), so the spawner loads none of them.
//
// TLS NOTE (Bun): the server certificate is pinned with plain `tls.ca`, full
// verification on. Bun's BoringSSL accepts a certificate as its own trust
// anchor only when it is a CA certificate, so the node's server certificate
// must be one (hostkit makes it so: self-signed, CA:TRUE, pathlen:0,
// keyCertSign). Incus's default one (CA:FALSE) fails with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE — and `rejectUnauthorized: false` is not a
// way out: Bun then skips `checkServerIdentity` as well, so any certificate
// would pass. `readIncusTlsMaterial` refuses the unpinnable shape at boot.
//
// Every request is bounded: a timeout, the caller's cancellation (the
// ambient signal the caller hands the client included), and a cap on the
// response size. A background operation is waited for with the API's
// long-poll (`/1.0/operations/<id>/wait`).

import {
  IncusApiError,
  INCUS_STATUS,
  parseImageAlias,
  parseInstance,
  parseInstanceState,
  parseNetwork,
  parseOperation,
  parseProfile,
  parseProject,
  parseServerInfo,
  parseStoragePool,
  parseVolume,
  type IncusConfigMap,
  type IncusDevices,
  type IncusImageAlias,
  type IncusInstance,
  type IncusInstanceCreate,
  type IncusInstanceState,
  type IncusNetwork,
  type IncusOperation,
  type IncusProfile,
  type IncusProject,
  type IncusServerInfo,
  type IncusStoragePool,
  type IncusVolume,
  type IncusVolumeCreate,
} from './api.ts';

/** PEM contents: the server certificate the connection is pinned to, and the
 * client certificate and key it presents. */
export interface IncusTlsMaterial {
  ca: string;
  cert: string;
  key: string;
}

export interface IncusRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  signal: AbortSignal;
  tls: IncusTlsMaterial;
}

export type IncusFetch = (
  url: string,
  init: IncusRequestInit,
) => Promise<Response>;

/** Opens a websocket to the node, presenting the client certificate and
 * pinning the server's, as a request does. */
export type IncusWebSocketFactory = (
  url: string,
  tls: IncusTlsMaterial,
) => WebSocket;

export interface IncusClientOptions {
  /** Origin of the API, `https://host:port`. */
  endpoint: string;
  /** The project every project-scoped call targets. */
  project: string;
  tls: IncusTlsMaterial;
  /** The caller's ambient cancellation, read at every request: once it is
   * aborted, the call in flight ends and no further attempt starts (the
   * spawner hands its operation budget here). `() => undefined` for none. */
  signal: () => AbortSignal | undefined;
  /** Budget of one request, long-poll waits excepted (default 15 s). */
  requestTimeoutMs?: number;
  /** Largest response body read (default 32 MiB). */
  maxResponseBytes?: number;
  /** Test seam (and the Unix socket's transport); defaults to the global
   * fetch over TLS. An endpoint that is not `https:` needs one. */
  fetch?: IncusFetch;
  /** Test seam; defaults to Bun's `WebSocket` with the same TLS material. */
  webSocket?: IncusWebSocketFactory;
  /** Test seam for the pause between a read's attempts. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** How long one long-poll of an operation lasts at most. */
const OPERATION_POLL_SECONDS = 30;
/** Attempts of a read that failed on the wire or on a gateway. */
const READ_ATTEMPTS = 3;
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([502, 503, 504]);

export type IncusQuery = Record<string, string | undefined>;

/** One request through the client's transport: every bound of the client
 * applies (timeout, cancellation, response cap). */
export interface IncusSendOptions {
  query?: IncusQuery;
  /** A JSON body. */
  json?: unknown;
  /** A raw body, with its headers. */
  raw?: Uint8Array;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Reads are retried on a transport failure; writes never are. */
  retry?: boolean;
  /** A smaller response cap for this request than the client's. */
  maxResponseBytes?: number;
}

export interface IncusReply {
  status: number;
  etag: string | undefined;
  headers: Headers;
  body: Uint8Array;
}

interface Envelope {
  type: string;
  metadata: unknown;
}

const defaultFetch: IncusFetch = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: init.signal,
    tls: init.tls,
    // The node answers where it was asked. A redirect would carry the client
    // certificate to a place nobody pinned.
    redirect: 'error',
  });

const defaultWebSocket: IncusWebSocketFactory = (url, tls) =>
  new WebSocket(url, { tls });

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Does this failure say the runtime image (or its alias) is not there? */
export function isIncusImageMissing(error: unknown): boolean {
  if (!(error instanceof IncusApiError)) return false;
  return (
    /\b(image|alias)\b/i.test(error.message) &&
    /not found|no such|does not exist/i.test(error.message)
  );
}

/** Does this failure say another operation holds the instance? Incus refuses
 * an update of an instance while its start or stop runs ("Instance is busy
 * running a \"start\" operation", an HTTP 500): nothing is wrong with the
 * instance, and a moment later it is free. */
export function isIncusBusy(error: unknown): boolean {
  return (
    error instanceof IncusApiError && /\bis busy running\b/i.test(error.message)
  );
}

/** Does this failure say the name is taken? Incus answers a create under an
 * existing instance name with a plain error (an HTTP 500 carrying "already
 * exists") from one check and with a 409 from another, so both count. */
export function isIncusNameConflict(error: unknown): boolean {
  if (!(error instanceof IncusApiError)) return false;
  return error.status === 409 || /already exists/i.test(error.message);
}

async function readBounded(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw new IncusApiError(
      `Incus answered ${declared} bytes, over the ${max}-byte cap`,
      413,
    );
  }
  if (res.body === null) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new IncusApiError(
        `Incus answered more than the ${max}-byte cap`,
        413,
      );
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export class IncusClient {
  readonly project: string;
  private readonly origin: string;
  private readonly tls: IncusTlsMaterial;
  private readonly ambientSignal: () => AbortSignal | undefined;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly doFetch: IncusFetch;
  private readonly webSocketFactory: IncusWebSocketFactory;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: IncusClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' && options.fetch === undefined) {
      throw new Error(
        `The Incus endpoint ${endpoint.origin} is not https: the API is reached over mutual TLS (or through a transport that says otherwise)`,
      );
    }
    this.origin = endpoint.origin;
    this.project = options.project;
    this.tls = options.tls;
    this.ambientSignal = options.signal;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.doFetch = options.fetch ?? defaultFetch;
    this.webSocketFactory = options.webSocket ?? defaultWebSocket;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  // ---- transport ---------------------------------------------------------

  private url(path: string, query: IncusQuery = {}): string {
    const url = new URL(path, this.origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async attempt(
    method: string,
    path: string,
    options: IncusSendOptions,
  ): Promise<IncusReply> {
    const signals = [
      AbortSignal.timeout(options.timeoutMs ?? this.requestTimeoutMs),
    ];
    const ambient = this.ambientSignal();
    if (ambient !== undefined) signals.push(ambient);
    if (options.signal !== undefined) signals.push(options.signal);
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    if (signal === undefined) throw new Error('no abort signal');
    const headers: Record<string, string> = { ...options.headers };
    let body: string | Uint8Array | undefined;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.raw !== undefined) {
      headers['content-type'] = 'application/octet-stream';
      body = options.raw;
    }
    const res = await this.doFetch(this.url(path, options.query), {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal,
      tls: this.tls,
    });
    const payload = await readBounded(
      res,
      Math.min(
        options.maxResponseBytes ?? this.maxResponseBytes,
        this.maxResponseBytes,
      ),
    );
    const etag = res.headers.get('etag') ?? undefined;
    if (res.status >= 400) {
      throw new IncusApiError(
        failureMessage(method, path, res.status, payload),
        res.status,
      );
    }
    return { status: res.status, etag, headers: res.headers, body: payload };
  }

  /** One request; a read is tried again on a transport failure or a gateway
   * answer, never after the caller's own cancellation. The door the package's
   * own modules (exec, files, volumes, snapshots, state) call through. */
  async send(
    method: string,
    path: string,
    options: IncusSendOptions = {},
  ): Promise<IncusReply> {
    const attempts = options.retry === true ? READ_ATTEMPTS : 1;
    let last: unknown;
    for (let i = 0; i < attempts; i += 1) {
      this.ambientSignal()?.throwIfAborted();
      options.signal?.throwIfAborted();
      try {
        return await this.attempt(method, path, options);
      } catch (error) {
        this.ambientSignal()?.throwIfAborted();
        options.signal?.throwIfAborted();
        if (
          error instanceof IncusApiError &&
          !RETRYABLE_STATUS.has(error.status)
        ) {
          throw error;
        }
        last = error;
        if (i < attempts - 1) {
          console.warn(
            `[sandbox.incus] ${method} ${path} attempt ${i + 1}/${attempts} failed:`,
            error instanceof Error ? error.message : error,
          );
          await this.sleep(200 * (i + 1));
        }
      }
    }
    throw last;
  }

  private envelope(reply: IncusReply, method: string, path: string): Envelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(reply.body));
    } catch (error) {
      throw new IncusApiError(
        `Incus answered ${method} ${path} with something that is not JSON`,
        502,
        { cause: error },
      );
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      throw new IncusApiError(
        `Incus answered ${method} ${path} with an unknown envelope`,
        502,
      );
    }
    return { type: parsed.type, metadata: parsed.metadata };
  }

  /** A synchronous call's `metadata`. */
  async sync(
    method: string,
    path: string,
    options: IncusSendOptions = {},
  ): Promise<unknown> {
    const reply = await this.send(method, path, options);
    const envelope = this.envelope(reply, method, path);
    if (envelope.type !== 'sync') {
      throw new IncusApiError(
        `Incus answered ${method} ${path} with a ${envelope.type} response, not a synchronous one`,
        502,
      );
    }
    return envelope.metadata;
  }

  /** A call that starts a background operation: waits for it, and returns
   * the finished operation. A call Incus answered synchronously (a volume
   * create or delete) has nothing to wait for. */
  async operation(
    method: string,
    path: string,
    options: IncusSendOptions & { waitMs: number },
  ): Promise<IncusOperation | undefined> {
    const reply = await this.send(method, path, options);
    const envelope = this.envelope(reply, method, path);
    if (envelope.type === 'sync') return undefined;
    if (envelope.type !== 'async') {
      throw new IncusApiError(
        `Incus answered ${method} ${path} with a ${envelope.type} response`,
        502,
      );
    }
    const started = parseOperation(envelope.metadata);
    return this.waitOperation(started, options.waitMs, options.signal);
  }

  /** A call that starts a background operation, returned as started, not
   * waited for (an exec whose websockets the caller connects first). */
  async startOperation(
    method: string,
    path: string,
    options: IncusSendOptions = {},
  ): Promise<IncusOperation> {
    const reply = await this.send(method, path, options);
    const envelope = this.envelope(reply, method, path);
    if (envelope.type !== 'async') {
      throw new IncusApiError(
        `Incus answered ${method} ${path} with a ${envelope.type} response, not a background operation`,
        502,
      );
    }
    return parseOperation(envelope.metadata);
  }

  /** Asks Incus to cancel a background operation. Not every operation can be
   * cancelled: a record-output exec cannot ("This operation can't be
   * cancelled", a failure that throws); a websocket exec ends when its
   * control socket closes. */
  async cancelOperation(id: string): Promise<void> {
    await this.sync('DELETE', `/1.0/operations/${encodeURIComponent(id)}`);
  }

  /** Opens a websocket on the node (an exec's file descriptors), over the
   * same pinned mutual TLS as every request. */
  openWebSocket(path: string, query: IncusQuery = {}): WebSocket {
    const url = new URL(this.url(path, query));
    if (url.protocol !== 'https:') {
      throw new Error(
        'A websocket to Incus needs the TLS endpoint; this client has none',
      );
    }
    url.protocol = 'wss:';
    return this.webSocketFactory(url.toString(), this.tls);
  }

  /** Long-polls the operation to its end. A failed operation throws with its
   * own message (status 500: Incus names no HTTP status for it). */
  async waitOperation(
    started: IncusOperation,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<IncusOperation> {
    const deadline = Date.now() + waitMs;
    let current = started;
    for (;;) {
      if (current.statusCode >= INCUS_STATUS.success) {
        if (current.statusCode === INCUS_STATUS.success) return current;
        throw new IncusApiError(
          current.err === ''
            ? `Incus operation ${current.id} ${current.status.toLowerCase()}`
            : current.err,
          current.statusCode === INCUS_STATUS.cancelled ? 499 : 500,
        );
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new IncusApiError(
          `Incus operation ${current.id} did not finish within ${waitMs} ms`,
          504,
        );
      }
      const pollSeconds = Math.max(
        1,
        Math.min(OPERATION_POLL_SECONDS, Math.ceil(remainingMs / 1000)),
      );
      const metadata = await this.sync(
        'GET',
        `/1.0/operations/${encodeURIComponent(current.id)}/wait`,
        {
          query: { timeout: String(pollSeconds) },
          timeoutMs: pollSeconds * 1000 + this.requestTimeoutMs,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      current = parseOperation(metadata);
    }
  }

  // ---- the server and what it was told to hold -----------------------------

  async getServer(): Promise<IncusServerInfo> {
    return parseServerInfo(await this.sync('GET', '/1.0', { retry: true }));
  }

  async getProject(name = this.project): Promise<IncusProject> {
    return parseProject(
      await this.sync('GET', `/1.0/projects/${encodeURIComponent(name)}`, {
        retry: true,
      }),
    );
  }

  async getProfile(name: string): Promise<IncusProfile> {
    return parseProfile(
      await this.sync('GET', `/1.0/profiles/${encodeURIComponent(name)}`, {
        query: { project: this.project },
        retry: true,
      }),
    );
  }

  async getNetwork(name: string): Promise<IncusNetwork> {
    return parseNetwork(
      await this.sync('GET', `/1.0/networks/${encodeURIComponent(name)}`, {
        query: { project: this.project },
        retry: true,
      }),
    );
  }

  async getStoragePool(name: string): Promise<IncusStoragePool> {
    return parseStoragePool(
      await this.sync('GET', `/1.0/storage-pools/${encodeURIComponent(name)}`, {
        retry: true,
      }),
    );
  }

  // ---- instances ---------------------------------------------------------

  async listInstances(): Promise<IncusInstance[]> {
    const metadata = await this.sync('GET', '/1.0/instances', {
      query: { project: this.project, recursion: '1' },
      retry: true,
    });
    if (!Array.isArray(metadata)) {
      throw new IncusApiError('Incus answered a malformed instance list', 502);
    }
    return metadata.map(parseInstance);
  }

  /** The instance and its ETag; undefined when there is none (404). */
  async getInstance(
    name: string,
  ): Promise<
    { instance: IncusInstance; etag: string | undefined } | undefined
  > {
    const path = `/1.0/instances/${encodeURIComponent(name)}`;
    let reply: IncusReply;
    try {
      reply = await this.send('GET', path, {
        query: { project: this.project },
        retry: true,
      });
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
    const envelope = this.envelope(reply, 'GET', path);
    return { instance: parseInstance(envelope.metadata), etag: reply.etag };
  }

  /** The instance with its runtime state (addresses); `state` is undefined
   * while it is not running. */
  async getInstanceFull(name: string): Promise<
    | {
        instance: IncusInstance;
        etag: string | undefined;
        state: IncusInstanceState | undefined;
      }
    | undefined
  > {
    const path = `/1.0/instances/${encodeURIComponent(name)}`;
    let reply: IncusReply;
    try {
      reply = await this.send('GET', path, {
        query: { project: this.project, recursion: '1' },
        retry: true,
      });
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
    const metadata = this.envelope(reply, 'GET', path).metadata;
    const instance = parseInstance(metadata);
    const rawState = isRecord(metadata) ? metadata.state : undefined;
    return {
      instance,
      etag: reply.etag,
      state: isRecord(rawState) ? parseInstanceState(rawState) : undefined,
    };
  }

  /** Creates the instance (and starts it when the body says so) and waits
   * for the operation. */
  async createInstance(
    body: IncusInstanceCreate,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.operation('POST', '/1.0/instances', {
      query: { project: this.project },
      json: body,
      waitMs,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  /** Merges config keys and devices into the instance (an empty config value
   * unsets the key). With `ifMatch` the write happens only if the instance is
   * still the one that ETag was read from — a mismatch is a 412. */
  async patchInstance(
    name: string,
    patch: { config?: IncusConfigMap; devices?: IncusDevices },
    options: { ifMatch?: string } = {},
  ): Promise<void> {
    await this.sync('PATCH', `/1.0/instances/${encodeURIComponent(name)}`, {
      query: { project: this.project },
      json: patch,
      ...(options.ifMatch === undefined
        ? {}
        : { headers: { 'if-match': options.ifMatch } }),
    });
  }

  /** Starts, stops, freezes or unfreezes the instance and waits. A stop
   * without `force` asks the instance to shut down within `timeoutSeconds`. */
  async changeInstanceState(
    name: string,
    action: 'start' | 'stop' | 'freeze' | 'unfreeze',
    options: { force?: boolean; timeoutSeconds?: number; waitMs: number },
  ): Promise<void> {
    await this.operation(
      'PUT',
      `/1.0/instances/${encodeURIComponent(name)}/state`,
      {
        query: { project: this.project },
        json: {
          action,
          force: options.force === true,
          stateful: false,
          timeout: options.timeoutSeconds ?? -1,
        },
        waitMs: options.waitMs,
      },
    );
  }

  /** Deletes a stopped instance; false when there was none (404). */
  async deleteInstance(name: string, waitMs: number): Promise<boolean> {
    try {
      await this.operation(
        'DELETE',
        `/1.0/instances/${encodeURIComponent(name)}`,
        { query: { project: this.project }, waitMs },
      );
      return true;
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) return false;
      throw error;
    }
  }

  /** Writes a file inside the instance, running or not. */
  async pushFile(
    name: string,
    path: string,
    content: string | Uint8Array,
    options: { mode: string; uid: number; gid: number },
  ): Promise<void> {
    const raw =
      typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await this.sync(
      'POST',
      `/1.0/instances/${encodeURIComponent(name)}/files`,
      {
        query: { project: this.project, path },
        raw,
        headers: {
          'x-incus-type': 'file',
          'x-incus-write': 'overwrite',
          'x-incus-mode': options.mode,
          'x-incus-uid': String(options.uid),
          'x-incus-gid': String(options.gid),
        },
      },
    );
  }

  /** Does the path exist inside the instance? */
  async fileExists(name: string, path: string): Promise<boolean> {
    try {
      await this.send(
        'HEAD',
        `/1.0/instances/${encodeURIComponent(name)}/files`,
        { query: { project: this.project, path }, retry: true },
      );
      return true;
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) return false;
      throw error;
    }
  }

  /** The last `tailBytes` of the instance's console log — where an OCI
   * container's output goes. Consumes as `readConsole` does. */
  async getConsoleLog(name: string, tailBytes: number): Promise<string> {
    const text = new TextDecoder().decode(await this.readConsole(name));
    return text.length > tailBytes ? text.slice(-tailBytes) : text;
  }

  /** The instance's console as Incus keeps it. While the instance runs, a
   * read CONSUMES what it returns (a second read starts where this one
   * ended); after a stop it returns what liblxc kept. */
  async readConsole(
    name: string,
    options: { maxBytes?: number } = {},
  ): Promise<Uint8Array> {
    const reply = await this.send(
      'GET',
      `/1.0/instances/${encodeURIComponent(name)}/console`,
      {
        query: { project: this.project, type: 'log' },
        ...(options.maxBytes === undefined
          ? {}
          : { maxResponseBytes: options.maxBytes }),
      },
    );
    return reply.body;
  }

  /** The log files Incus keeps for the instance (`lxc.log`; Incus 7.6 lists
   * no `console.log`), as their names. */
  async listInstanceLogs(name: string): Promise<string[]> {
    const metadata = await this.sync(
      'GET',
      `/1.0/instances/${encodeURIComponent(name)}/logs`,
      { query: { project: this.project }, retry: true },
    );
    if (!Array.isArray(metadata)) {
      throw new IncusApiError('Incus answered a malformed log list', 502);
    }
    return metadata
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(item.lastIndexOf('/') + 1));
  }

  /** One of the instance's log files, bounded. */
  async readInstanceLog(
    name: string,
    file: string,
    options: { maxBytes?: number } = {},
  ): Promise<Uint8Array> {
    if (!/^[A-Za-z0-9._-]+$/.test(file) || file === '.' || file === '..') {
      throw new Error(`Not a log file name: ${JSON.stringify(file)}`);
    }
    const reply = await this.send(
      'GET',
      `/1.0/instances/${encodeURIComponent(name)}/logs/${encodeURIComponent(file)}`,
      {
        query: { project: this.project },
        retry: true,
        ...(options.maxBytes === undefined
          ? {}
          : { maxResponseBytes: options.maxBytes }),
      },
    );
    return reply.body;
  }

  // ---- workspace volumes -------------------------------------------------

  private volumesPath(pool: string): string {
    return `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom`;
  }

  async getVolume(
    pool: string,
    name: string,
  ): Promise<IncusVolume | undefined> {
    try {
      return parseVolume(
        await this.sync(
          'GET',
          `${this.volumesPath(pool)}/${encodeURIComponent(name)}`,
          { query: { project: this.project }, retry: true },
        ),
      );
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  async listVolumes(pool: string): Promise<IncusVolume[]> {
    const metadata = await this.sync('GET', this.volumesPath(pool), {
      query: { project: this.project, recursion: '1' },
      retry: true,
    });
    if (!Array.isArray(metadata)) {
      throw new IncusApiError('Incus answered a malformed volume list', 502);
    }
    return metadata.map(parseVolume);
  }

  async createVolume(pool: string, body: IncusVolumeCreate): Promise<void> {
    await this.operation('POST', this.volumesPath(pool), {
      query: { project: this.project },
      json: body,
      waitMs: 120_000,
    });
  }

  /** Deletes the volume; false when there was none (404). A volume an
   * instance still uses is refused (400/409), which throws. */
  async deleteVolume(pool: string, name: string): Promise<boolean> {
    try {
      await this.operation(
        'DELETE',
        `${this.volumesPath(pool)}/${encodeURIComponent(name)}`,
        { query: { project: this.project }, waitMs: 120_000 },
      );
      return true;
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) return false;
      throw error;
    }
  }

  // ---- images ------------------------------------------------------------

  async getImageAlias(alias: string): Promise<IncusImageAlias | undefined> {
    try {
      return parseImageAlias(
        await this.sync(
          'GET',
          `/1.0/images/aliases/${encodeURIComponent(alias)}`,
          { query: { project: this.project }, retry: true },
        ),
      );
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /** The project's image aliases. */
  async listImageAliases(): Promise<IncusImageAlias[]> {
    const metadata = await this.sync('GET', '/1.0/images/aliases', {
      query: { project: this.project, recursion: '1' },
      retry: true,
    });
    if (!Array.isArray(metadata)) {
      throw new IncusApiError('Incus answered a malformed alias list', 502);
    }
    return metadata.map(parseImageAlias);
  }

  /** Points a new alias at an image by its fingerprint; a taken name throws
   * (see `isIncusNameConflict`). */
  async createImageAlias(alias: string, target: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(target)) {
      throw new Error(`Not an image fingerprint: ${JSON.stringify(target)}`);
    }
    await this.sync('POST', '/1.0/images/aliases', {
      query: { project: this.project },
      json: { name: alias, target, description: '' },
    });
  }

  /** Deletes an alias, not its image; false when there was none (404). */
  async deleteImageAlias(alias: string): Promise<boolean> {
    try {
      await this.sync(
        'DELETE',
        `/1.0/images/aliases/${encodeURIComponent(alias)}`,
        { query: { project: this.project } },
      );
      return true;
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) return false;
      throw error;
    }
  }

  /** Deletes an image by its fingerprint and waits; false when there was
   * none (404). */
  async deleteImage(fingerprint: string, waitMs: number): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new Error(
        `Not an image fingerprint: ${JSON.stringify(fingerprint)}`,
      );
    }
    try {
      await this.operation(
        'DELETE',
        `/1.0/images/${encodeURIComponent(fingerprint)}`,
        { query: { project: this.project }, waitMs },
      );
      return true;
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) return false;
      throw error;
    }
  }

  /** Pulls an image from an OCI registry into the project under `alias`, and
   * waits (a runtime image is several GiB). */
  async pullOciImage(
    source: { server: string; alias: string },
    alias: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.operation('POST', '/1.0/images', {
      query: { project: this.project },
      json: {
        aliases: [{ name: alias }],
        source: {
          type: 'image',
          mode: 'pull',
          protocol: 'oci',
          server: source.server,
          alias: source.alias,
        },
      },
      waitMs,
      timeoutMs: this.requestTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
  }
}

function failureMessage(
  method: string,
  path: string,
  status: number,
  payload: Uint8Array,
): string {
  let detail = '';
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (isRecord(parsed) && typeof parsed.error === 'string') {
      detail = parsed.error;
    }
  } catch (error) {
    // A body that is not JSON (a gateway's page): the status tells enough. An
    // empty one is no news: a HEAD has no body, and the pool's readiness poll
    // is a HEAD that is answered 404 until the standby is up.
    if (payload.byteLength > 0) {
      console.warn(
        `[sandbox.incus] ${method} ${path} answered ${status} with a body that is not JSON:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return `Incus ${method} ${path} answered ${status}${detail === '' ? '' : `: ${detail}`}`;
}
