import type { ParsedPath } from './types';

// Parse a /dav/<orgSlug>/<namespace>/<...segments> URL pathname into its
// structured form. Returns null if it doesn't fit the shape.
// `isCollection` reflects the trailing slash — WebDAV uses it as the
// signal for "this is a folder" in many places (PROPFIND, MKCOL).
export function parseDavPath(pathname: string): ParsedPath | null {
  if (!pathname.startsWith('/dav/')) return null;
  const isCollection = pathname.endsWith('/') && pathname !== '/dav/';
  const trimmed = pathname.slice(5); // strip '/dav/'
  const raw = trimmed.replace(/\/+$/, '').split('/');
  if (raw.length < 1 || raw[0] === '') return null;

  const orgSlug = decodeURIComponent(raw[0]);
  if (!isValidOrgSlug(orgSlug)) return null;

  if (raw.length === 1) {
    // /dav/<orgSlug>/ — pseudo-root listing
    return {
      orgSlug,
      namespace: 'documents',
      segments: [],
      isCollection: true,
    };
  }

  const rawNamespace = decodeURIComponent(raw[1]);
  if (rawNamespace !== 'documents' && rawNamespace !== '.trash') return null;

  const segments: string[] = [];
  for (let i = 2; i < raw.length; i++) {
    const seg = decodeURIComponent(raw[i]);
    if (!isValidSegment(seg)) return null;
    segments.push(seg);
  }

  return {
    orgSlug,
    namespace: rawNamespace,
    segments,
    isCollection,
  };
}

// Build the wire URL for a resource (used in PROPFIND `<href>` and in
// Location headers after MOVE/COPY). Reverses parseDavPath.
export function buildDavPath(parsed: {
  orgSlug: string;
  namespace: 'documents' | '.trash';
  segments: string[];
  isCollection: boolean;
}): string {
  const parts = [
    'dav',
    encodeURIComponent(parsed.orgSlug),
    parsed.namespace,
    ...parsed.segments.map(encodeURIComponent),
  ];
  let s = '/' + parts.join('/');
  if (parsed.isCollection) s += '/';
  return s;
}

// Canonical wire path used as the lock key — strips the /dav/<orgSlug>
// scope so the lock identity is org-internal. e.g.
// "/dav/myorg/documents/foo/bar" → "/documents/foo/bar".
export function lockKeyFromParsed(parsed: {
  namespace: 'documents' | '.trash';
  segments: string[];
}): string {
  if (parsed.segments.length === 0) return '/' + parsed.namespace;
  return (
    '/' +
    parsed.namespace +
    '/' +
    parsed.segments.map(encodeURIComponent).join('/')
  );
}

function isValidOrgSlug(s: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(s);
}

// Document / folder names. Reject path-traversal characters and NUL.
// Permits unicode / spaces / dots (other than . and ..).
function isValidSegment(s: string): boolean {
  if (s.length === 0 || s.length > 255) return false;
  if (s === '.' || s === '..') return false;
  if (s.includes('/') || s.includes('\\') || s.includes('\0')) return false;
  return true;
}
