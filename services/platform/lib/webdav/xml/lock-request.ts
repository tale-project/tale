import { XMLParser } from 'fast-xml-parser';

export interface LockInfo {
  scope: 'exclusive' | 'shared';
  type: 'write';
  ownerXml: string; // raw inner XML — clients pass-through this for display
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

export function parseLockBody(body: string): LockInfo | null {
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
  const ownerXml = ownerMatch ? ownerMatch[1].trim() : '';

  return { scope, type: 'write', ownerXml };
}

// "Second-600" → 600, "Infinite" → null (rejected by caller — we cap).
export function parseTimeoutHeader(header: string | null): number | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.trim().match(/^Second-(\d+)$/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// Parse a wire If: header for the lock-token form: "(<opaquelocktoken:UUID>)"
// Returns the UUID(s) the client presented. We accept any token in the
// list as proof of lock ownership.
export function parseIfHeaderTokens(header: string | null): string[] {
  if (!header) return [];
  const out: string[] = [];
  const re = /<\s*opaquelocktoken:([^>]+)\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function pick(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}
