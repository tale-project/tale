// The session's view of itself where it does not run in a container.
//
// The session contract names a session's files under `/agent` and the
// platform's doors by the deployment's addresses (`http://backend-api:3005`,
// `http://sandbox-llm-gateway:8080`): a container makes both true with a mount
// and a network alias. A raw session (services/sandbox/docs/raw.md) runs as
// plain processes on its device, so its files live under a real directory of
// the device and its doors behind loopback relays of the device's spawner.
// runnerd is the one boundary everything that enters a session passes, so it
// translates there: what the platform sends in (an exec's argv, environment,
// working directory and stdin, the session environment, the paths of file
// operations) has the contract's names replaced by the real ones, and what
// an exec prints has the real names replaced by the contract's, so the
// platform reads a raw session exactly like a container.
//
// The contents of staged files are NOT translated: an inline item carries the
// platform's SHA-256 of its bytes and a cached source is verified against it.
// Configuration the platform hands a harness rides its argv (the MCP
// configuration, the appended instructions), which is translated.
//
// A name is replaced only as a whole: `/agent` before `/`, the end, or a
// character that cannot continue a path segment, and after the start or a
// character that cannot end one (so `/agents`, `/agent-adapters` and
// `https://example.com/agent` stay as they are); an origin only where the next
// character cannot continue its host or port. Every name is ASCII, so a byte
// replacement never splits a UTF-8 character.

/** The environment variable that carries the view (JSON, {@link SessionViewSpec}). */
export const SESSION_VIEW_ENV = 'TALE_SESSION_VIEW';

/** What the raw backend hands runnerd. */
export interface SessionViewSpec {
  /** The contract's root, `/agent`. */
  root: string;
  /** The real directory the root stands for (absolute, no trailing slash). */
  real: string;
  /** Contract origin → the origin the session reaches it at on this device. */
  origins: ReadonlyArray<readonly [string, string]>;
  /** Further image paths the platform names → where the device has them:
   * the runtime's helper programs (`/usr/local/bin/tale-git-credential`,
   * which the platform arms git's credential helper with). Whole paths,
   * replaced like the root. */
  paths?: ReadonlyArray<readonly [string, string]>;
}

/** A path or origin as it may appear in a view: printable ASCII that needs no
 * escaping in JSON, a shell word or a URL, so a replacement can never break
 * the line, the argument or the JSON string it lands in. */
const SAFE_NAME = /^[A-Za-z0-9._~/:+@%-]+$/;

/** Bytes that continue a path segment or a host name. */
function isNameByte(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    byte === 0x2d || // -
    byte === 0x2e || // .
    byte === 0x5f || // _
    byte === 0x7e // ~
  );
}

const SLASH = 0x2f;
const COLON = 0x3a;

interface Rule {
  from: Buffer;
  to: Buffer;
  /** A path: whole-segment boundaries on both sides. An origin: only the
   * byte after it is checked (its scheme anchors the start). */
  kind: 'path' | 'origin';
}

/** May a match of `rule` start right after `before` (-1: the start)? */
function startsCleanly(rule: Rule, before: number): boolean {
  if (rule.kind === 'origin' || before < 0) return true;
  return !isNameByte(before) && before !== SLASH;
}

/** May a match of `rule` end right before `after` (-1: the end)? */
function endsCleanly(rule: Rule, after: number): boolean {
  if (after < 0) return true;
  if (rule.kind === 'path') return after === SLASH || !isNameByte(after);
  // An origin: `:8080` must not continue as `:80801`, a host not as a longer
  // host; a path, query, fragment or any other byte ends it.
  return !isNameByte(after) && after !== COLON;
}

/** The rules a byte can start, by that byte. */
type RuleIndex = ReadonlyArray<readonly Rule[] | undefined>;

function indexRules(rules: readonly Rule[]): RuleIndex {
  const index: Rule[][] = [];
  for (const rule of rules) {
    const first = rule.from[0];
    if (first === undefined) continue;
    (index[first] ??= []).push(rule);
  }
  return index;
}

/**
 * Replace every whole occurrence of the rules' `from` in `input`, the longest
 * rule first where two start at the same byte (`index` keeps them in that
 * order). `before` is the byte that came right before `input` (-1: none),
 * so a stream judges a name that starts its chunk as it would mid-chunk.
 * With `final` false, a match (or the start of one) that the input ends in
 * is left unreplaced and its offset returned as `held`, for the caller to
 * keep until more bytes come.
 */
function replaceAll(
  input: Buffer,
  index: RuleIndex,
  final: boolean,
  before = -1,
): { out: Buffer; held: number } {
  const parts: Buffer[] = [];
  let copied = 0;
  let i = 0;
  scan: while (i < input.length) {
    const candidates = index[input[i] ?? -1];
    if (candidates === undefined) {
      i += 1;
      continue;
    }
    for (const rule of candidates) {
      const { from } = rule;
      const room = input.length - i;
      if (room < from.length) {
        // The input ends in what may be the start of this name.
        if (!final && from.subarray(0, room).equals(input.subarray(i))) {
          parts.push(input.subarray(copied, i));
          return { out: Buffer.concat(parts), held: i };
        }
        continue;
      }
      if (!input.subarray(i, i + from.length).equals(from)) continue;
      const prev = i === 0 ? before : (input[i - 1] ?? -1);
      if (!startsCleanly(rule, prev)) continue;
      const afterIndex = i + from.length;
      if (afterIndex === input.length && !final) {
        // Whether it ends cleanly depends on the next byte.
        parts.push(input.subarray(copied, i));
        return { out: Buffer.concat(parts), held: i };
      }
      const after = afterIndex < input.length ? (input[afterIndex] ?? -1) : -1;
      if (!endsCleanly(rule, after)) continue;
      parts.push(input.subarray(copied, i), rule.to);
      i = afterIndex;
      copied = i;
      continue scan;
    }
    i += 1;
  }
  if (copied === 0) return { out: input, held: -1 };
  parts.push(input.subarray(copied));
  return { out: Buffer.concat(parts), held: -1 };
}

/** One direction of a view over a byte stream (an exec's stdout or stderr):
 * a name split across two chunks is still replaced, and only a suffix that
 * may begin a name waits for the next chunk, so a line that ends in a
 * newline is never held back. */
export class ViewStream {
  private pending: Buffer = Buffer.alloc(0);
  /** The last byte this stream passed on, the context of the next name. */
  private last = -1;

  constructor(private readonly index: RuleIndex | null) {}

  push(chunk: Buffer): Buffer {
    if (this.index === null || chunk.length === 0) return chunk;
    const bytes =
      this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    const { out, held } = replaceAll(bytes, this.index, false, this.last);
    // Copy the held suffix so it cannot retain a large pipe chunk.
    this.pending =
      held < 0 ? Buffer.alloc(0) : Buffer.from(bytes.subarray(held));
    if (held !== 0) {
      const passed = held < 0 ? bytes : bytes.subarray(0, held);
      this.last = passed[passed.length - 1] ?? this.last;
    }
    return out;
  }

  flush(): Buffer {
    if (this.index === null || this.pending.length === 0) {
      return Buffer.alloc(0);
    }
    const { out } = replaceAll(this.pending, this.index, true, this.last);
    this.last = this.pending[this.pending.length - 1] ?? this.last;
    this.pending = Buffer.alloc(0);
    return out;
  }
}

export class SessionView {
  private readonly inboundRules: RuleIndex | null;
  private readonly outboundRules: RuleIndex | null;

  constructor(readonly spec: SessionViewSpec | null) {
    const pairs: Array<{ virtual: string; real: string; kind: Rule['kind'] }> =
      spec === null
        ? []
        : [
            { virtual: spec.root, real: spec.real, kind: 'path' },
            ...(spec.paths ?? []).map(([virtual, real]) => ({
              virtual,
              real,
              kind: 'path' as const,
            })),
            ...spec.origins.map(([virtual, real]) => ({
              virtual,
              real,
              kind: 'origin' as const,
            })),
          ];
    // Longest first: of two names starting at the same byte, the longer is
    // the more specific one.
    const sorted = (rules: Rule[]) =>
      rules.sort((a, b) => b.from.length - a.from.length);
    const build = (rules: Rule[]): RuleIndex | null =>
      rules.length === 0 ? null : indexRules(sorted(rules));
    this.inboundRules = build(
      pairs.map((p) => ({
        from: Buffer.from(p.virtual),
        to: Buffer.from(p.real),
        kind: p.kind,
      })),
    );
    this.outboundRules = build(
      pairs.map((p) => ({
        from: Buffer.from(p.real),
        to: Buffer.from(p.virtual),
        kind: p.kind,
      })),
    );
  }

  /** True on a raw host; a container's runnerd translates nothing. */
  get active(): boolean {
    return this.spec !== null;
  }

  /** A text the platform sends into the session, with the real names. */
  inbound(text: string): string {
    if (this.inboundRules === null || text.length === 0) return text;
    return replaceAll(
      Buffer.from(text),
      this.inboundRules,
      true,
    ).out.toString();
  }

  /** Bytes the platform sends in that are text: translated when they are
   * valid UTF-8, passed as they are otherwise (binary stdin is not ours to
   * touch). */
  inboundBytes(bytes: Buffer): Buffer {
    if (this.inboundRules === null || bytes.length === 0) return bytes;
    if (!isUtf8(bytes)) return bytes;
    return replaceAll(bytes, this.inboundRules, true).out;
  }

  /** A text that leaves the session, with the contract's names. */
  outbound(text: string): string {
    if (this.outboundRules === null || text.length === 0) return text;
    return replaceAll(
      Buffer.from(text),
      this.outboundRules,
      true,
    ).out.toString();
  }

  /** A translator for one output stream of one exec. */
  outboundStream(): ViewStream {
    return new ViewStream(this.outboundRules);
  }

  /** Every value of an environment, translated in. */
  inboundEnv(
    env: Readonly<Record<string, string>> | undefined,
  ): Record<string, string> | undefined {
    if (env === undefined || !this.active) return env;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
      out[name] = typeof value === 'string' ? this.inbound(value) : value;
    }
    return out;
  }
}

function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export class SessionViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionViewError';
  }
}

/** Parse {@link SESSION_VIEW_ENV}; null when it is unset (a container). A
 * view that is set but unusable throws: a raw session must never start
 * without its translation, or the platform would address `/agent` on the
 * device's own disk. */
export function parseSessionView(
  raw: string | undefined,
): SessionViewSpec | null {
  if (raw === undefined || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SessionViewError(`${SESSION_VIEW_ENV} is not JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionViewError(`${SESSION_VIEW_ENV} must be an object`);
  }
  const record = Object.fromEntries(Object.entries(value));
  const name = (key: string, given: unknown): string => {
    if (typeof given !== 'string' || !SAFE_NAME.test(given)) {
      throw new SessionViewError(
        `${SESSION_VIEW_ENV}: "${key}" must be a plain ASCII path or origin`,
      );
    }
    return given;
  };
  const root = name('root', record.root);
  const real = name('real', record.real);
  for (const [key, path] of [
    ['root', root],
    ['real', real],
  ] as const) {
    if (!path.startsWith('/') || path === '/' || path.endsWith('/')) {
      throw new SessionViewError(
        `${SESSION_VIEW_ENV}: "${key}" must be an absolute directory without a trailing slash`,
      );
    }
  }
  if (
    real === root ||
    real.startsWith(`${root}/`) ||
    root.startsWith(`${real}/`)
  ) {
    throw new SessionViewError(
      `${SESSION_VIEW_ENV}: the real root must lie outside the contract's root`,
    );
  }
  const rawOrigins = record.origins ?? [];
  if (!Array.isArray(rawOrigins) || rawOrigins.length > 16) {
    throw new SessionViewError(
      `${SESSION_VIEW_ENV}: "origins" must be a list of at most 16 pairs`,
    );
  }
  const origins = rawOrigins.map((pair, index): readonly [string, string] => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new SessionViewError(
        `${SESSION_VIEW_ENV}: origins[${index}] must be a [contract, local] pair`,
      );
    }
    const [from, to] = [
      name(`origins[${index}][0]`, pair[0]),
      name(`origins[${index}][1]`, pair[1]),
    ];
    for (const origin of [from, to]) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new SessionViewError(
          `${SESSION_VIEW_ENV}: ${origin} is not an origin`,
        );
      }
      if (url.origin !== origin) {
        throw new SessionViewError(
          `${SESSION_VIEW_ENV}: ${origin} must be a bare origin (scheme, host, port)`,
        );
      }
    }
    return [from, to] as const;
  });
  const rawPaths = record.paths ?? [];
  if (!Array.isArray(rawPaths) || rawPaths.length > 64) {
    throw new SessionViewError(
      `${SESSION_VIEW_ENV}: "paths" must be a list of at most 64 pairs`,
    );
  }
  const paths = rawPaths.map((pair, index): readonly [string, string] => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new SessionViewError(
        `${SESSION_VIEW_ENV}: paths[${index}] must be an [image, device] pair`,
      );
    }
    const from = name(`paths[${index}][0]`, pair[0]);
    const to = name(`paths[${index}][1]`, pair[1]);
    for (const path of [from, to]) {
      if (!path.startsWith('/') || path.endsWith('/')) {
        throw new SessionViewError(
          `${SESSION_VIEW_ENV}: paths[${index}] must be absolute paths without a trailing slash`,
        );
      }
    }
    if (from === root || from.startsWith(`${root}/`)) {
      throw new SessionViewError(
        `${SESSION_VIEW_ENV}: paths[${index}] lies under the root, which maps on its own`,
      );
    }
    return [from, to] as const;
  });
  return { root, real, origins, ...(paths.length > 0 ? { paths } : {}) };
}

/** The view of this runnerd, read once from its environment. */
export function loadSessionView(
  env: NodeJS.ProcessEnv = process.env,
): SessionView {
  return new SessionView(parseSessionView(env[SESSION_VIEW_ENV]));
}
