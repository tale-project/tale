/**
 * The two eras of the MCP protocol on one endpoint, request by request.
 *
 * A legacy client (2025-11-25 and the revisions before it) opens with
 * `initialize` and then names the negotiated revision in the
 * `MCP-Protocol-Version` header — or, before 2025-06-18, nothing at all. A
 * modern client (2026-07-28) never initializes: every request carries its
 * revision, its capabilities and its name in `params._meta`, mirrored into
 * HTTP headers so a proxy can route on them without reading the body
 * (`MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` for the methods that
 * name something). The body decides the era: a request whose `_meta` names
 * a revision is modern, and so is one whose header names a modern revision;
 * everything else is served as before.
 *
 * A modern request is judged before anything runs, in the order MCP's own
 * SDK answers it: a header naming another revision than the body (-32020),
 * a missing or malformed envelope (-32602), a revision the endpoint does not
 * speak (-32022), then a missing standard header or one that does not say
 * what the body says (-32020) — each with HTTP 400, so a client speaking
 * both eras knows it reached a modern server and corrects the request
 * instead of falling back to `initialize`.
 */

import {
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSIONS,
} from '../../../lib/mcp/server';
import { displayClientName } from '../../../lib/shared/client-name';

/** The `_meta` keys MCP reserves for what a modern request says about
 * itself, and the one a result names the server under. */
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/** MCP's `HeaderMismatch`: a header does not say what the body says, or a
 * header the revision requires is missing or malformed. */
const HEADER_MISMATCH = -32020;

/** MCP's `UnsupportedProtocolVersion`, which a client that speaks several
 * revisions recognises and retries on, with `data.supported` to choose
 * from. */
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** The most characters of a revision a refusal repeats back. */
const MAX_ECHOED_VERSION = 128;

/** The methods that name what they act on, and where the body says it —
 * what `Mcp-Name` must carry. */
const NAMED_BY: Readonly<Record<string, 'name' | 'uri'>> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isModernVersion(version: string | null): boolean {
  return version !== null && MCP_MODERN_PROTOCOL_VERSIONS.includes(version);
}

/** The protocol headers of one request, as sent (null when absent). */
export interface EraHeaders {
  readonly protocolVersion: string | null;
  readonly method: string | null;
  readonly name: string | null;
}

export function eraHeaders(headers: Headers): EraHeaders {
  return {
    protocolVersion: headers.get('mcp-protocol-version'),
    method: headers.get('mcp-method'),
    name: headers.get('mcp-name'),
  };
}

/** A message's `params._meta`, when it has one. */
function metaOf(message: unknown): Record<string, unknown> | null {
  if (!isRecord(message) || !isRecord(message.params)) return null;
  const meta = message.params._meta;
  return isRecord(meta) ? meta : null;
}

/** Whether a message's body claims the modern era: its `_meta` names a
 * revision, whatever the value. A legacy client's `_meta` carries at most a
 * progress token. */
export function claimsModernEnvelope(message: unknown): boolean {
  const meta = metaOf(message);
  return meta !== null && META_PROTOCOL_VERSION in meta;
}

/** Whether one message is served as a modern request. */
export function isModernMessage(
  message: unknown,
  headers: EraHeaders,
): boolean {
  return (
    claimsModernEnvelope(message) || isModernVersion(headers.protocolVersion)
  );
}

const SENTINEL = /^=\?base64\?(.*)\?=$/s;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** What a plain header value may hold: visible ASCII, space and tab. */
const PLAIN_HEADER_VALUE = /^[\x20-\x7E\t]*$/;

/**
 * A mirrored header's value as the body would hold it: a plain value as
 * sent, a value in MCP's Base64 form (`=?base64?…?=`, for a name or address
 * a header cannot carry plainly) decoded as UTF-8. Null when it is neither:
 * a character a header value may not hold, Base64 that is not, or bytes
 * that are not UTF-8.
 */
export function decodeMirroredHeader(raw: string): string | null {
  const encoded = SENTINEL.exec(raw);
  if (encoded === null) return PLAIN_HEADER_VALUE.test(raw) ? raw : null;
  const base64 = encoded[1] ?? '';
  if (!BASE64.test(base64)) return null;
  const bytes = Buffer.from(base64, 'base64');
  const text = bytes.toString('utf8');
  // Bytes that are not UTF-8 decode to U+FFFD and no longer round-trip.
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

/** How one modern request was judged: served — with the revision and the
 * name the client gave itself on this request —, or refused before
 * anything runs, always with HTTP 400. */
export type ModernVerdict =
  | {
      readonly kind: 'served';
      readonly version: string;
      readonly clientName: string | null;
    }
  | {
      readonly kind: 'refused';
      readonly code: number;
      readonly message: string;
      readonly data?: Record<string, unknown>;
    };

function headerMismatch(
  message: string,
  data?: Record<string, unknown>,
): ModernVerdict {
  return {
    kind: 'refused',
    code: HEADER_MISMATCH,
    message: `Header mismatch: ${message}`,
    ...(data === undefined ? {} : { data }),
  };
}

/** The refusal of a request naming a revision the endpoint does not speak,
 * listing the ones it does. */
export function unsupportedVersion(requested: string): {
  readonly code: number;
  readonly message: string;
  readonly data: Record<string, unknown>;
} {
  const legacy =
    !isModernVersion(requested) && MCP_PROTOCOL_VERSIONS.includes(requested);
  return {
    code: UNSUPPORTED_PROTOCOL_VERSION,
    message: legacy
      ? `Unsupported protocol version "${requested}" in _meta — ${requested} is opened with initialize; a request that carries its revision in _meta speaks ${MCP_MODERN_PROTOCOL_VERSIONS.join(', ')}`
      : `Unsupported protocol version "${requested.slice(0, 64)}" — this endpoint speaks ${MCP_PROTOCOL_VERSIONS.join(', ')}`,
    // What the client named, bounded: a revision is ten characters, and the
    // refusal never echoes a header or a body at length.
    data: {
      supported: [...MCP_PROTOCOL_VERSIONS],
      requested: requested.slice(0, MAX_ECHOED_VERSION),
    },
  };
}

/**
 * Judge one modern request — an envelope-checked JSON-RPC request with an
 * id — before it is dispatched.
 */
export function judgeModernRequest(
  method: string,
  params: unknown,
  headers: EraHeaders,
): ModernVerdict {
  const meta = isRecord(params) && isRecord(params._meta) ? params._meta : null;
  const claimed = meta?.[META_PROTOCOL_VERSION];

  // The header and the body name two revisions.
  if (
    headers.protocolVersion !== null &&
    typeof claimed === 'string' &&
    claimed !== headers.protocolVersion
  ) {
    return headerMismatch(
      `MCP-Protocol-Version header "${headers.protocolVersion.slice(0, 64)}" does not match the revision in _meta, "${claimed.slice(0, 64)}"`,
    );
  }

  // The envelope every modern request carries.
  const missing: string[] = [];
  const malformed: string[] = [];
  if (meta === null) {
    missing.push(META_PROTOCOL_VERSION, META_CLIENT_CAPABILITIES);
  } else {
    if (claimed === undefined) missing.push(META_PROTOCOL_VERSION);
    else if (typeof claimed !== 'string' || claimed === '') {
      malformed.push(META_PROTOCOL_VERSION);
    }
    const capabilities = meta[META_CLIENT_CAPABILITIES];
    if (capabilities === undefined) missing.push(META_CLIENT_CAPABILITIES);
    else if (!isRecord(capabilities)) malformed.push(META_CLIENT_CAPABILITIES);
    const clientInfo = meta[META_CLIENT_INFO];
    if (clientInfo !== undefined && !isRecord(clientInfo)) {
      malformed.push(META_CLIENT_INFO);
    }
  }
  if (missing.length > 0 || malformed.length > 0) {
    const parts = [
      ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
      ...(malformed.length > 0 ? [`malformed ${malformed.join(', ')}`] : []),
    ];
    return {
      kind: 'refused',
      code: -32602,
      message: `Invalid params: a ${MCP_MODERN_PROTOCOL_VERSIONS.join(', ')} request carries its revision and the client's capabilities in params._meta — ${parts.join('; ')}`,
      data: {
        ...(missing.length > 0 ? { missing } : {}),
        ...(malformed.length > 0 ? { malformed } : {}),
      },
    };
  }
  const version = typeof claimed === 'string' ? claimed : '';
  if (!isModernVersion(version)) {
    return { kind: 'refused', ...unsupportedVersion(version) };
  }

  // The headers a proxy routes on must say what the body says.
  if (headers.protocolVersion === null) {
    return headerMismatch(
      `the MCP-Protocol-Version header is required and must name ${version}`,
    );
  }
  if (headers.method === null) {
    return headerMismatch(
      `the Mcp-Method header is required and must name "${method.slice(0, 64)}"`,
    );
  }
  if (headers.method !== method) {
    return headerMismatch(
      `Mcp-Method header "${headers.method.slice(0, 64)}" does not match the method in the body, "${method.slice(0, 64)}"`,
    );
  }
  const namedBy = NAMED_BY[method];
  if (namedBy !== undefined) {
    if (headers.name === null) {
      return headerMismatch(
        `the Mcp-Name header is required for ${method} and must carry params.${namedBy}`,
      );
    }
    const decoded = decodeMirroredHeader(headers.name);
    if (decoded === null) {
      return headerMismatch(
        'the Mcp-Name header holds characters a header cannot carry plainly — send them as =?base64?<UTF-8 in Base64>?=',
      );
    }
    const body = isRecord(params) ? params[namedBy] : undefined;
    if (decoded !== body) {
      return headerMismatch(
        `the Mcp-Name header does not match params.${namedBy} in the body`,
      );
    }
  }

  const clientInfo = meta?.[META_CLIENT_INFO];
  return {
    kind: 'served',
    version,
    clientName: isRecord(clientInfo)
      ? displayClientName(clientInfo.name)
      : null,
  };
}
