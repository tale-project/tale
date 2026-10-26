/**
 * The proxies a deployment sends its requests to other websites through.
 *
 * `OUTBOUND_PROXY_URLS` lists HTTP proxies, comma- or whitespace-separated
 * (`http://user:password@203.0.113.7:8080, http://203.0.113.8:8080`), and
 * the platform hands its requests to them in turn: the website crawler, the
 * chat assistant's web fetch, the remote images an email draws and video
 * ingestion from the backend, and every connection a sandbox session opens
 * to the internet from the egress service. `VIDEO_INGEST_PROXY_URL`, when
 * set, takes video ingestion out of the rotation.
 *
 * Two readers parse the list: this module for the backend, and the egress
 * service's `outbound-proxies.awk` for its squid hop. So the grammar is
 * narrower than a URL parser's on purpose, and both readers refuse what the
 * other could read differently: the scheme `http`, an optional user name and
 * password (both, percent-encoded wherever they hold a character other than
 * a letter, a digit or one of `-._~!$&'()*+;=:`, each escape a printable
 * ASCII character, at most 128 bytes together once decoded), a host name or
 * an IPv4 address, an optional port, and nothing after it but one `/`. A
 * malformed entry fails boot rather than sending traffic out unproxied.
 *
 * Layer A: no imports — the backend and the guard tests share it.
 */

export const OUTBOUND_PROXY_URLS_ENV = 'OUTBOUND_PROXY_URLS';

/** The form an entry takes, quoted in every refusal. */
const ENTRY_FORM = 'http://[user:password@]host[:port]';

/** Thrown for a malformed entry; the message names its position, never its
 * text, which may carry a password. */
export class OutboundProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundProxyConfigError';
  }
}

/** One configured proxy. */
export interface OutboundProxy {
  /** The proxy as clients are given it: `http://[user:password@]host:port`,
   * credentials percent-encoded as written. Never log it. */
  readonly url: string;
  /** `http://host:port` — what a log line or an error names. */
  readonly label: string;
  /** Lower-case host name or IPv4 address. */
  readonly host: string;
  readonly port: number;
  /** `user:password` exactly as written (percent-encoded), or null. */
  readonly credentials: string | null;
}

/** Characters a user name or password may hold unencoded: RFC 3986's
 * unreserved characters and sub-delimiters, less the comma that separates
 * entries, plus the colon that separates the two and the percent sign of an
 * escape. */
const USERINFO = /^[A-Za-z0-9\-._~!$&'()*+;=:%]*$/;

const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/g;

/** The most a user name and password may hold together once decoded, the
 * colon between them included: squid's limit for a parent's login
 * (`MAX_LOGIN_SZ`), past which it overruns a buffer and crashes on the first
 * request through that proxy. */
const MAX_CREDENTIALS_BYTES = 128;

/** Whether every escape in `value` encodes a printable ASCII character
 * (`%20` to `%7E`), which every client decodes alike: squid keeps some control
 * characters as written, and undici cannot decode a byte of a multi-byte
 * character on its own. */
function printableEscapes(value: string): boolean {
  for (const [escape] of value.matchAll(PERCENT_ESCAPE)) {
    const code = Number.parseInt(escape.slice(1), 16);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/** `value` with its escapes decoded; each is printable ASCII by then. */
function decodeEscapes(value: string): string {
  return value.replace(PERCENT_ESCAPE, (escape) =>
    String.fromCharCode(Number.parseInt(escape.slice(1), 16)),
  );
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** A label a URL parser decodes as punycode, and refuses when it is not
 * valid punycode, where the egress reader cannot tell the difference. */
const PUNYCODE_LABEL = /^xn--/;

/** A last label a URL parser reads as a number, which makes the whole host
 * an IPv4 address in its eyes (`10.1`, `0x7f.1`). */
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/;

const DECIMAL_OCTET = /^(?:0|[1-9][0-9]*)$/;

const PORT = /^[1-9][0-9]*$/;

/** Split the raw value on commas and ASCII whitespace, dropping empties. */
export function splitOutboundProxyList(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  return raw.split(/[ \t\n\r\f\v,]+/).filter((entry) => entry.length > 0);
}

/** Lower-case ASCII letters only: `toLowerCase` also maps some other letters
 * onto ASCII ones (the Kelvin sign onto `k`), which the egress service's
 * reader, working on bytes, never does. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function refuse(position: number, reason: string): never {
  throw new OutboundProxyConfigError(
    `${OUTBOUND_PROXY_URLS_ENV} entry ${position} ${reason} (expected ${ENTRY_FORM})`,
  );
}

function validHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split('.');
  if (
    !labels.every(
      (label) =>
        label.length <= 63 &&
        HOST_LABEL.test(label) &&
        !PUNYCODE_LABEL.test(label),
    )
  ) {
    return false;
  }
  const last = labels[labels.length - 1] ?? '';
  if (!NUMERIC_LABEL.test(last)) return true;
  // A numeric last label: only a canonical dotted quad means the same host
  // to both readers.
  return (
    labels.length === 4 &&
    labels.every((label) => DECIMAL_OCTET.test(label) && Number(label) <= 255)
  );
}

/**
 * One entry of the list, checked. `position` is its 1-based place, which
 * the refusal names. Throws {@link OutboundProxyConfigError}.
 */
export function parseOutboundProxyUrl(
  entry: string,
  position: number,
): OutboundProxy {
  if (asciiLower(entry.slice(0, 7)) !== 'http://') {
    refuse(position, 'is not an http:// proxy URL');
  }
  const rest = entry.slice(7);
  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  if (tail !== '' && tail !== '/') {
    refuse(position, 'has a path, query or fragment after the host');
  }

  const at = authority.lastIndexOf('@');
  let credentials: string | null = null;
  let hostPort = authority;
  if (at !== -1) {
    const userinfo = authority.slice(0, at);
    hostPort = authority.slice(at + 1);
    if (
      !USERINFO.test(userinfo) ||
      userinfo.replace(PERCENT_ESCAPE, '').includes('%')
    ) {
      refuse(
        position,
        'has a character in its user name or password that must be percent-encoded',
      );
    }
    if (!printableEscapes(userinfo)) {
      refuse(
        position,
        'encodes a character other than printable ASCII in its user name or password',
      );
    }
    const colon = userinfo.indexOf(':');
    if (colon <= 0 || colon === userinfo.length - 1) {
      refuse(
        position,
        'has credentials without both a user name and a password',
      );
    }
    if (decodeEscapes(userinfo).length > MAX_CREDENTIALS_BYTES) {
      refuse(
        position,
        `has a user name and password longer than ${MAX_CREDENTIALS_BYTES} bytes together`,
      );
    }
    // squid reads these as login modes rather than a user name: `*` passes on
    // the client's own user name, `NEGOTIATE` asks for Kerberos.
    const user = decodeEscapes(userinfo.slice(0, colon));
    if (user.startsWith('*') || user.startsWith('NEGOTIATE')) {
      refuse(
        position,
        'has a user name squid reads as an instruction (it begins with * or NEGOTIATE)',
      );
    }
    credentials = userinfo;
  }

  if (hostPort.startsWith('[')) {
    refuse(
      position,
      'names an IPv6 address; name the proxy by host name or IPv4 address',
    );
  }
  const parts = hostPort.split(':');
  if (parts.length > 2) refuse(position, 'names no valid host and port');
  const host = asciiLower(parts[0] ?? '');
  if (!validHost(host)) refuse(position, 'names no valid host');
  let port = 80;
  if (parts.length === 2) {
    const digits = parts[1] ?? '';
    if (!PORT.test(digits) || digits.length > 5 || Number(digits) > 65535) {
      refuse(position, 'has a port outside 1-65535');
    }
    port = Number(digits);
  }

  const label = `http://${host}:${port}`;
  return {
    url: credentials === null ? label : `http://${credentials}@${host}:${port}`,
    label,
    host,
    port,
    credentials,
  };
}

/**
 * The configured proxies, in the order written; empty when the value is
 * unset or blank. Throws {@link OutboundProxyConfigError} on the first
 * malformed entry. A proxy listed twice is asked twice as often.
 */
export function parseOutboundProxyUrls(
  raw: string | null | undefined,
): OutboundProxy[] {
  return splitOutboundProxyList(raw).map((entry, index) =>
    parseOutboundProxyUrl(entry, index + 1),
  );
}
