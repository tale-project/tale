// Docker reads answered by the Engine API over its local Unix socket.
//
// A `docker` CLI call starts a Go process — tens of MB and tens of ms — to
// send one HTTP request to the daemon, after waiting for a CLI slot
// (spawn-util.ts). The spawner's frequent reads, a session container's
// inspect and the session listings, send that request themselves: Bun's
// fetch speaks HTTP over the socket the CLI would use. Only where that socket
// is certain, and only for a call that names its `engine` read; every other
// call, and every call against any other target, runs the CLI as before.
//
// An answer comes back in the CLI's shape: the exit code, stdout as the
// call's --format template prints it, stderr as the CLI reports a daemon
// error ("Error response from daemon: No such container: …"). So a caller
// judges one result whichever way it was answered, with the parsing it has.

/** The Engine API version reads ask in: the one the docker:27 CLI of the
 * spawner image speaks, so an answer has the shape that CLI was given. A
 * daemon older than this is asked in its own version, as the CLI does. */
export const ENGINE_API_VERSION = '1.47';

/** The version the CLI assumes of a daemon whose ping names none. */
const UNNAMED_DAEMON_API_VERSION = '1.24';

/** The largest answer read: a listing of every session takes a few KB per
 * session. A larger one fails the read, as an unanswered one. */
const ENGINE_ANSWER_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The Unix socket the docker CLI is pointed at, when that is certain:
 * DOCKER_HOST names one, and neither another CLI (DOCKER_BIN, an isolated
 * test CLI) nor a context (DOCKER_CONTEXT) is set. Null otherwise, so the CLI
 * answers and resolves its own context, configuration or remote host. The
 * spawner image sets DOCKER_HOST to the socket every deployment mounts.
 * Read per call, as spawn-util reads DOCKER_BIN.
 */
export function engineSocket(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (env.DOCKER_BIN !== undefined || env.DOCKER_CONTEXT) return null;
  const host = env.DOCKER_HOST ?? '';
  return host.startsWith('unix:///') ? host.slice('unix://'.length) : null;
}

/** A docker CLI read the Engine API can answer: its request, and what the
 * call's --format template prints for the API's JSON answer. */
export interface EngineRead {
  /** The request path after the API version, with its query. */
  readonly path: string;
  /** stdout as the CLI prints it for the answer; throws on an answer the
   * CLI could not have decoded either. */
  readonly render: (answer: unknown) => string;
}

/** What a container inspect template reads of the inspect document, as the
 * CLI's typed decoding holds it: an absent field is its zero value. (A
 * template naming a field the typed struct spells otherwise, `.Id`, runs on
 * the raw JSON in the CLI instead, where an absent field or a null label map
 * fails it. The daemon sends every field these reads use, and a session
 * container always has labels.) */
export interface InspectedContainer {
  /** `{{.Id}}` */
  readonly id: string;
  /** `{{.Created}}` */
  readonly created: string;
  /** `{{.State.Status}}` */
  readonly status: string;
  /** `{{.State.Running}}` */
  readonly running: boolean;
  /** `{{.State.OOMKilled}}` */
  readonly oomKilled: boolean;
  /** `{{range .Mounts}}`, each mount's `.Destination` and `.Source`. */
  readonly mounts: readonly {
    readonly destination: string;
    readonly source: string;
  }[];
  /** `{{with index .Config.Labels "<name>"}}{{.}}{{end}}`: the label's
   * value, or nothing. */
  label(name: string): string;
}

/** What a `docker ps` template reads of one listed container. */
export interface ListedContainer {
  /** `{{.State}}` */
  readonly state: string;
  /** `{{.Label "<name>"}}`: the label's value, or nothing. */
  label(name: string): string;
}

/** A container inspect's --format template, with what it prints rendered
 * from the Engine API's inspect document. Declared together, so neither
 * changes without the other in view. */
export interface ContainerFormat {
  readonly template: string;
  readonly render: (container: InspectedContainer) => string;
}

/** A `docker ps` --format template, with what it prints for one container
 * rendered from the Engine API's listing. */
export interface ListingFormat {
  readonly template: string;
  readonly render: (container: ListedContainer) => string;
}

/** `{{json <string>}}`: the string as the CLI's template function writes it.
 * It turns Go's HTML escaping off, but Go escapes the two Unicode line
 * separators regardless. */
export function jsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16)}`,
  );
}

/** A Docker read: the CLI's arguments, and the same read from the Engine
 * API. Hand both to runDocker (`runDocker(args, { engine })`). */
export interface DockerRead {
  readonly args: string[];
  readonly engine: EngineRead;
}

/** `docker inspect --format <template> <ref>` of one container, and the same
 * from `GET /containers/<ref>/json`. Like the CLI, a line per container. */
export function containerInspect(
  ref: string,
  format: ContainerFormat,
): DockerRead {
  return {
    args: ['inspect', '--format', format.template, ref],
    engine: {
      path: `/containers/${encodeURIComponent(ref)}/json`,
      render: (answer) => `${format.render(inspectedContainer(answer))}\n`,
    },
  };
}

/** `docker ps <options> --format <template>`, and the same from
 * `GET /containers/json`, whose query is read from the very options the CLI
 * gets, so the two never list different containers. */
export function containerListing(
  options: readonly string[],
  format: ListingFormat,
): DockerRead {
  return {
    args: ['ps', ...options, '--format', format.template],
    engine: {
      path: `/containers/json${listingQuery(options)}`,
      render: (answer) => {
        if (!Array.isArray(answer)) {
          throw new TypeError('the container listing is not a list');
        }
        return answer
          .map((row) => `${format.render(listedContainer(row))}\n`)
          .join('');
      },
    },
  };
}

/** The query of a listing: `--all` and each `--filter key=value`, which the
 * API takes as `{"key": ["value", …]}`. `--no-trunc` only lengthens ids and
 * names no listing format reads. Anything else changes what the CLI lists
 * or prints, so it is refused rather than answered differently. */
function listingQuery(options: readonly string[]): string {
  const query = new URLSearchParams();
  const filters: Record<string, string[]> = {};
  for (let at = 0; at < options.length; at += 1) {
    const option = options[at];
    if (option === '--all' || option === '-a') {
      query.set('all', '1');
    } else if (option === '--filter' || option === '-f') {
      const filter = options[at + 1] ?? '';
      const equals = filter.indexOf('=');
      if (equals <= 0) {
        throw new Error(
          `docker ps filter ${JSON.stringify(filter)} is not key=value`,
        );
      }
      (filters[filter.slice(0, equals)] ??= []).push(filter.slice(equals + 1));
      at += 1;
    } else if (option !== '--no-trunc') {
      throw new Error(`docker ps option ${option} has no Engine API read`);
    }
  }
  if (Object.keys(filters).length > 0) {
    query.set('filters', JSON.stringify(filters));
  }
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An object field the CLI decodes into a struct pointer: a template that
 * reads below an absent one fails in the CLI, so it fails here too. */
function objectField(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  if (!isObject(value)) throw new TypeError(`${key} is not an object`);
  return value;
}

/** A string field: absent or null reads as "", as the CLI decodes it, and
 * any other type fails, as it does the CLI's decoding. */
function stringField(object: JsonObject, key: string): string {
  const value = object[key];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError(`${key} is not a string`);
  return value;
}

/** A boolean field: absent or null reads as false, as the CLI decodes it. */
function booleanField(object: JsonObject, key: string): boolean {
  const value = object[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${key} is not a boolean`);
  }
  return value;
}

/** A label map: absent or null holds no label. */
function labelsField(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new TypeError(`${key} is not a map`);
  return value;
}

/** Each field is read when a template reads it, so an answer fails only
 * where the same template fails in the CLI. */
function inspectedContainer(answer: unknown): InspectedContainer {
  if (!isObject(answer)) {
    throw new TypeError('the inspect answer is not an object');
  }
  return {
    get id() {
      return stringField(answer, 'Id');
    },
    get created() {
      return stringField(answer, 'Created');
    },
    get status() {
      return stringField(objectField(answer, 'State'), 'Status');
    },
    get running() {
      return booleanField(objectField(answer, 'State'), 'Running');
    },
    get oomKilled() {
      return booleanField(objectField(answer, 'State'), 'OOMKilled');
    },
    get mounts() {
      const mounts = answer.Mounts ?? [];
      if (!Array.isArray(mounts)) throw new TypeError('Mounts is not a list');
      return mounts.map((mount: unknown) => {
        if (!isObject(mount)) throw new TypeError('a mount is not an object');
        return {
          destination: stringField(mount, 'Destination'),
          source: stringField(mount, 'Source'),
        };
      });
    },
    label: (name) =>
      stringField(labelsField(objectField(answer, 'Config'), 'Labels'), name),
  };
}

function listedContainer(row: unknown): ListedContainer {
  if (!isObject(row)) {
    throw new TypeError('a listed container is not an object');
  }
  return {
    get state() {
      return stringField(row, 'State');
    },
    label: (name) => stringField(labelsField(row, 'Labels'), name),
  };
}

/** An Engine API answer in the shape of spawn-util's RunDockerResult. */
export interface EngineResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface EngineAskOptions {
  /** The call's whole budget, as runDocker resolves it; null for none. */
  budgetMs: number | null;
  /** Cancels the request; the answer is then exit -1, as for a CLI call
   * cancelled before it started or killed by the cancellation. */
  signal?: AbortSignal;
  /** Caps stdout as the CLI path caps it, marking it truncated. */
  stdoutMaxBytes?: number;
}

/** The API version asked of each socket once its daemon named one. */
const negotiated = new Map<string, string>();

/** Forget every negotiated version (tests). */
export function forgetEngineVersions(): void {
  negotiated.clear();
}

/** The older of two `<major>.<minor>` API versions. */
function olderVersion(a: string, b: string): string {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor < bMajor || (aMajor === bMajor && aMinor < bMinor) ? a : b;
}

/** The version to ask the daemon at `socket` in: what its ping names, but no
 * newer than ENGINE_API_VERSION — the negotiation the CLI makes. Kept once
 * the daemon answered the ping, until it refuses it (versionTaken). */
async function apiVersion(
  socket: string,
  signal?: AbortSignal,
): Promise<string> {
  const known = negotiated.get(socket);
  if (known !== undefined) return known;
  const ping = await fetch('http://localhost/_ping', {
    unix: socket,
    method: 'HEAD',
    signal,
    redirect: 'error',
  });
  const named = ping.headers.get('api-version') ?? '';
  const version = olderVersion(
    /^\d+\.\d+$/.test(named) ? named : UNNAMED_DAEMON_API_VERSION,
    ENGINE_API_VERSION,
  );
  if (ping.ok) negotiated.set(socket, version);
  return version;
}

/** The version a daemon refusing the one it was asked in names instead:
 * "client version 1.47 is too old. Minimum supported API version is 1.50"
 * once a daemon outgrows the CLI the image ships, or "… too new. Maximum
 * supported API version is 1.45" after it was replaced by an older one. */
function versionTaken(error: string): string | null {
  return (
    /(?:Minimum|Maximum) supported API version is (\d+\.\d+)/.exec(
      error,
    )?.[1] ?? null
  );
}

/** The answer's body, or null when it exceeds ENGINE_ANSWER_MAX_BYTES. */
async function answerBody(response: Response): Promise<string | null> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ENGINE_ANSWER_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A refused request as the CLI reports it: the daemon's message from its
 * JSON error, else the body's own text. */
function daemonError(response: Response, body: string, url: string): string {
  if (body === '') {
    return `request returned ${response.statusText || `HTTP ${response.status}`} for API route and version ${url}, check if the server supports the requested API version`;
  }
  if (response.headers.get('content-type') !== 'application/json') {
    return `Error response from daemon: ${body.trim()}`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return `Error reading JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  const message =
    isObject(parsed) && typeof parsed.message === 'string'
      ? parsed.message
      : '';
  return `Error response from daemon: ${message.trim()}`;
}

/** stdout under the call's cap, cut as the CLI path cuts it. */
function cappedStdout(
  stdout: string,
  maxBytes: number | undefined,
): Pick<EngineResult, 'stdout' | 'stdoutTruncated'> {
  const bytes = Buffer.from(stdout, 'utf8');
  if (maxBytes === undefined || bytes.byteLength <= maxBytes) {
    return { stdout, stdoutTruncated: false };
  }
  return {
    stdout: new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, maxBytes),
    ),
    stdoutTruncated: true,
  };
}

function failure(exitCode: number, stderr: string): EngineResult {
  return {
    exitCode,
    stdout: '',
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

/** Why a request did not get through, by the error's code: never its whole
 * message, which could read like an answer about the object. */
function transportFault(error: unknown): string {
  if (error instanceof Error) {
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' && code !== '' ? code : error.name;
  }
  return 'unknown error';
}

/**
 * Answer a docker CLI read from the Engine API at `socket`, as the CLI would
 * have: exit 0 and the rendered stdout; exit 1 with the daemon's error, or
 * with the connection failure, as the CLI reports either; exit 124 when no
 * answer came within the budget; exit -1 when cancelled. Never rejects.
 */
export async function askEngine(
  socket: string,
  args: readonly string[],
  read: EngineRead,
  opts: EngineAskOptions,
): Promise<EngineResult> {
  const command = `docker ${args[0] ?? ''}`;
  if (opts.signal?.aborted) {
    return failure(-1, `${command}: aborted before the request started`);
  }
  const deadline =
    opts.budgetMs === null ? undefined : AbortSignal.timeout(opts.budgetMs);
  const signals = [opts.signal, deadline].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  try {
    let version = await apiVersion(socket, signal);
    for (let retried = false; ; retried = true) {
      const url = `http://localhost/v${version}${read.path}`;
      // The daemon never redirects; nothing on its socket may send a read on.
      const response = await fetch(url, {
        unix: socket,
        signal,
        redirect: 'error',
      });
      const body = await answerBody(response);
      if (body === null) {
        return failure(
          1,
          `${command}: the Docker Engine API answer exceeds ${ENGINE_ANSWER_MAX_BYTES} bytes`,
        );
      }
      if (response.ok) {
        return answered(read, body, command, opts.stdoutMaxBytes);
      }
      const error = daemonError(response, body, url);
      const taken = response.status === 400 ? versionTaken(error) : null;
      if (taken === null || taken === version || retried) {
        return failure(1, error);
      }
      // Asked again, once, in the version the daemon takes, which this
      // socket keeps from now on.
      negotiated.set(socket, taken);
      version = taken;
    }
  } catch (error) {
    if (opts.signal?.aborted) return failure(-1, `${command}: aborted`);
    if (deadline?.aborted) {
      return failure(
        124,
        `${command}: no answer from the Docker Engine API within ${opts.budgetMs} ms`,
      );
    }
    return failure(
      1,
      `${command}: error during connect to the Docker daemon at unix://${socket}: ${transportFault(error)}`,
    );
  }
}

/** A read the daemon answered: exit 0 and stdout as the template prints it,
 * or exit 1 for an answer it cannot be printed from. */
function answered(
  read: EngineRead,
  body: string,
  command: string,
  stdoutMaxBytes: number | undefined,
): EngineResult {
  let stdout: string;
  try {
    stdout = read.render(JSON.parse(body));
  } catch (error) {
    return failure(
      1,
      `${command}: unreadable Docker Engine API answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    exitCode: 0,
    ...cappedStdout(stdout, stdoutMaxBytes),
    stderr: '',
    stderrTruncated: false,
  };
}
