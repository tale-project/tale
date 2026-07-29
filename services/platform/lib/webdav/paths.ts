import type { ParsedPath } from './types';

// Parse a /dav/<orgSlug>/<namespace>/<...segments> URL pathname into its
// structured form. Returns null if it doesn't fit the shape.
// `isCollection` reflects the trailing slash — WebDAV uses it as the
// signal for "this is a folder" in many places (PROPFIND, MKCOL).
//
// All decoded segments are run through NFC normalization. macOS Finder
// sends NFD-encoded unicode (e.g. "café" = c-a-f-e-U+0301), while
// Linux/Windows clients send NFC ("café" = c-a-f-U+00E9). Without
// normalization, the same logical filename from different clients would
// hash/index to distinct rows.
//
// On malformed percent-encoding (`decodeURIComponent` throws URIError),
// we return null. The caller treats null as a 404. A 400 would be more
// correct for this specific case; surfacing that distinction is a
// future improvement at the call site.
export function parseDavPath(pathname: string): ParsedPath | null {
  if (!pathname.startsWith('/dav/')) return null;
  const isCollection = pathname.endsWith('/') && pathname !== '/dav/';
  const trimmed = pathname.slice(5); // strip '/dav/'
  const raw = trimmed.replace(/\/+$/, '').split('/');
  if (raw.length < 1 || raw[0] === '') return null;

  const orgSlug = safeDecodeNFC(raw[0]);
  if (orgSlug === null || !isValidOrgSlug(orgSlug)) return null;

  if (raw.length === 1) {
    // /dav/<orgSlug>/ — pseudo-root listing
    return {
      orgSlug,
      namespace: 'documents',
      segments: [],
      isCollection: true,
    };
  }

  const rawNamespace = safeDecodeNFC(raw[1]);
  if (rawNamespace === null) return null;
  if (rawNamespace !== 'documents' && rawNamespace !== '.trash') return null;

  const segments: string[] = [];
  for (let i = 2; i < raw.length; i++) {
    const decoded = safeDecodeNFC(raw[i]);
    if (decoded === null) return null;
    // Trim leading/trailing whitespace so the path layer matches the
    // backend's validateFolderName (which trims before storing). Without
    // this, " foo " is created as "foo" but resolved as " foo " — stranding
    // the resource — and " .. " would slip past the `..` guard below.
    const seg = decoded.trim();
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
// Location headers after MOVE/COPY). Reverses parseDavPath. Segments
// are NFC-normalized before percent-encoding so a round-trip from
// parseDavPath → buildDavPath produces a canonical, comparable URL
// regardless of the client's original encoding form.
export function buildDavPath(parsed: {
  orgSlug: string;
  namespace: 'documents' | '.trash';
  segments: string[];
  isCollection: boolean;
}): string {
  const parts = [
    'dav',
    encodeURIComponent(parsed.orgSlug.normalize('NFC')),
    parsed.namespace,
    ...parsed.segments.map((s) => encodeURIComponent(s.normalize('NFC'))),
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
    parsed.segments.map((s) => encodeURIComponent(s.normalize('NFC'))).join('/')
  );
}

// `decodeURIComponent` throws URIError on malformed input (e.g. "%ZZ"
// or a lone "%"). Catch and translate to a null sentinel so callers
// can map the failure to a 404 instead of bubbling a 500.
function safeDecodeNFC(s: string): string | null {
  try {
    return decodeURIComponent(s).normalize('NFC');
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
  }
}

function isValidOrgSlug(s: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(s);
}

// Document / folder names. Reject path-traversal characters, NUL, and
// C0/C1 control characters (incl. CR, LF, TAB, DEL) — these break
// HTTP headers, filesystems, and CSV/log lines.
//
// Exported because it is the grammar for a name in the org tree, not a
// detail of URL parsing: the native WebDAV connector actions validate
// their caller-supplied path segments with the same rule, so a name one
// surface accepts is a name the other accepts too.
//
// We deliberately do NOT reject Windows reserved names (CON, PRN, AUX,
// NUL, COM1-9, LPT1-9): they are legitimate filenames on Linux/macOS,
// which are the OSes the server itself runs on, and many users have
// real files named e.g. "Aux materials.pdf".
export function isValidSegment(s: string): boolean {
  if (s.length === 0 || s.length > 255) return false;
  // Whitespace-only names (e.g. " ") are degenerate: invisible in every
  // client, and they collide indistinguishably in a listing. Reject them
  // (a name with internal spaces like "my file.txt" is still fine).
  if (s.trim().length === 0) return false;
  if (s === '.' || s === '..') return false;
  if (s.includes('/') || s.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return false;
  return true;
}
