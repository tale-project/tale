import { XMLParser } from 'fast-xml-parser';

export interface LockInfo {
  scope: 'exclusive' | 'shared';
  type: 'write';
  ownerXml: string; // raw inner XML — clients pass-through this for display
}

// Hard cap on captured ownerXml length. Clients have no business sending
// owner blocks larger than this; truncating keeps a single malicious LOCK
// from anchoring a multi-KB blob in our `webdavLocks` row indefinitely.
const MAX_OWNER_XML_LEN = 4096;

export type OwnerExtractError =
  | { kind: 'doctype' }
  | { kind: 'entity' }
  | { kind: 'cdata' };

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

export function parseLockBody(
  body: string,
): LockInfo | OwnerExtractError | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null; // Lock refresh (no body).

  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const li = pick(parsed, 'lockinfo');
  if (!isRecord(li)) return null;

  const scopeNode = pick(li, 'lockscope');
  const scope =
    isRecord(scopeNode) && 'shared' in scopeNode ? 'shared' : 'exclusive';

  // Preserve owner element verbatim. We capture by regex from the raw
  // body since fast-xml-parser may flatten / coerce; clients are picky
  // about exact XML structure in lockdiscovery responses.
  const ownerMatch = trimmed.match(
    /<\s*(?:[A-Za-z0-9_-]+:)?owner\b[^>]*>([\s\S]*?)<\s*\/\s*(?:[A-Za-z0-9_-]+:)?owner\s*>/i,
  );
  let ownerXml = ownerMatch ? ownerMatch[1].trim() : '';

  // Hostile-XML guards. The captured ownerXml is later re-emitted in
  // both `<D:lockdiscovery>` (LOCK response) and PROPFIND results — any
  // active XML construct here can break clients or smuggle DOCTYPE /
  // ENTITY declarations into our DB. The fast-xml-parser front parse
  // already strips DOCTYPE at the top of the document, but a nested
  // `<!DOCTYPE>` or `<!ENTITY>` inside `<owner>` survives the regex
  // capture, so we sanity-check the substring explicitly.
  if (/<!DOCTYPE/i.test(ownerXml)) return { kind: 'doctype' };
  if (/<!ENTITY/i.test(ownerXml)) return { kind: 'entity' };
  if (/<!\[CDATA\[/i.test(ownerXml)) return { kind: 'cdata' };

  if (ownerXml.length > MAX_OWNER_XML_LEN) {
    // Truncate over reject — chooses resilience for clients that pad
    // owner with rich text. The trailing marker is intentional so
    // operators see truncation in stored rows.
    ownerXml = ownerXml.slice(0, MAX_OWNER_XML_LEN - 3) + '...';
  }

  return { scope, type: 'write', ownerXml };
}

// Discriminator for parseLockBody — true when the result is an error
// shape rather than a parsed LockInfo or refresh null.
export function isOwnerExtractError(
  v: LockInfo | OwnerExtractError | null,
): v is OwnerExtractError {
  return v !== null && 'kind' in v;
}

// "Second-600" → 600. "Infinite" → MAX_SAFE_INTEGER (caller clamps to
// MAX_TIMEOUT_SEC). Returns null when no parseable token is present.
//
// RFC 4918 §10.7 explicitly permits "Infinite" — silently dropping it
// breaks clients that always send it (some Windows builds, old Office).
export function parseTimeoutHeader(header: string | null): number | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (/^Infinite$/i.test(trimmed)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const m = trimmed.match(/^Second-(\d+)$/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// ---- If: header (RFC 4918 §10.4) ----------------------------------

export interface IfCondition {
  not: boolean;
  // Exactly one of token / etag is set per condition term.
  token?: string;
  etag?: string;
}

export interface IfHeaderClause {
  // Tagged-list form anchors the clause to a resource URI; null on
  // No-tag-list form (applies to the request-URI).
  resource: string | null;
  // AND inside a clause (all conditions must hold). OR across clauses.
  conditions: IfCondition[];
}

// Full RFC §10.4 grammar:
//   If = "If" ":" ( 1*No-tag-list | 1*Tagged-list )
//   No-tag-list = List
//   Tagged-list = Resource-Tag 1*List
//   List = "(" 1*Condition ")"
//   Condition = ["Not"] (State-token | "[" entity-tag "]")
//   State-token = Coded-URL
//   Coded-URL = "<" absolute-URI ">"
//   Resource-Tag = "<" Simple-ref ">"
//
// We tokenize the input by scanning characters: `<…>` URIs (could be
// tag or token), `[…]` etags, `Not`, parens. Anything else is
// whitespace-skipped.
export function parseIfHeader(header: string | null): IfHeaderClause[] {
  if (!header) return [];
  const out: IfHeaderClause[] = [];
  let i = 0;
  const len = header.length;

  // Tagged-list resource carries across following Lists until another
  // Resource-Tag appears.
  let currentResource: string | null = null;

  while (i < len) {
    const ch = header[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '<') {
      // Resource-Tag (only valid OUTSIDE a List — Lists open with `(`).
      const end = header.indexOf('>', i + 1);
      if (end === -1) break;
      currentResource = header.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '(') {
      const close = header.indexOf(')', i + 1);
      if (close === -1) break;
      const inner = header.slice(i + 1, close);
      const conditions = parseConditions(inner);
      if (conditions.length > 0) {
        out.push({ resource: currentResource, conditions });
      }
      i = close + 1;
      continue;
    }
    // Anything else (stray text) — skip one char and continue.
    i++;
  }
  return out;
}

function parseConditions(inner: string): IfCondition[] {
  const out: IfCondition[] = [];
  let i = 0;
  let not = false;
  const len = inner.length;

  while (i < len) {
    const ch = inner[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    // "Not" operator (case-insensitive per RFC).
    if (
      (ch === 'N' || ch === 'n') &&
      i + 2 < len &&
      /Not\b/i.test(inner.slice(i, i + 3))
    ) {
      not = true;
      i += 3;
      continue;
    }
    if (ch === '<') {
      const end = inner.indexOf('>', i + 1);
      if (end === -1) break;
      const raw = inner.slice(i + 1, end).trim();
      out.push({ not, token: extractOpaqueLockToken(raw) ?? raw });
      not = false;
      i = end + 1;
      continue;
    }
    if (ch === '[') {
      const end = inner.indexOf(']', i + 1);
      if (end === -1) break;
      const etag = inner.slice(i + 1, end).trim();
      out.push({ not, etag: stripEtagQuotes(etag) });
      not = false;
      i = end + 1;
      continue;
    }
    // Unknown char — advance to avoid infinite loop.
    i++;
  }
  return out;
}

function extractOpaqueLockToken(uri: string): string | null {
  const m = uri.match(/^opaquelocktoken:(.+)$/i);
  return m ? m[1].trim() : null;
}

function stripEtagQuotes(s: string): string {
  // ETag wire form may be `"abc"` or `W/"abc"`. Normalize to the bare
  // value for comparison; strong/weak distinction is up to the caller.
  let t = s;
  if (t.startsWith('W/') || t.startsWith('w/')) t = t.slice(2);
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    t = t.slice(1, -1);
  }
  return t;
}

// Back-compat shim. Older callers want the flat token list — they
// disregard tagged-resource scoping and just need to compare against
// known lock UUIDs. New callers should use `parseIfHeader` directly.
export function parseIfHeaderTokens(header: string | null): string[] {
  const clauses = parseIfHeader(header);
  const out: string[] = [];
  for (const clause of clauses) {
    for (const cond of clause.conditions) {
      // `Not` clauses still surface their token here — the legacy
      // semantics didn't distinguish positive/negative. Strict
      // lock-check callers should migrate to `parseIfHeader`.
      if (cond.token) out.push(cond.token);
    }
  }
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function pick(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}
