import { parseDavPath } from '../paths';
import type { WebDAVResponse } from '../types';

/** Every method the documents tree accepts — the full Class 2 set. */
const DAV_METHODS =
  'OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK';
/** A trashed document: readable, listable, never written or locked. */
const TRASH_FILE_METHODS = 'OPTIONS, GET, HEAD, PROPFIND';
/** The org root and the trash view: listable, nothing else. */
const READ_ONLY_COLLECTION_METHODS = 'OPTIONS, PROPFIND';

/**
 * The `Allow` for the target resource (RFC 9110 §10.2.1 — the methods THE
 * TARGET supports, not the server): Finder, Explorer and Office read it
 * to decide whether a mount is writable and whether to take a lock, so a
 * `.trash` mount that advertised PUT and LOCK presented as an ordinary
 * folder until the first save failed mid-edit with 403.
 *
 * A path that does not parse still advertises the full set: some clients
 * (KDE, Office, Finder) probe with `OPTIONS /dav`, `OPTIONS /dav/`, or
 * `OPTIONS *` before they have org context, and must be able to detect
 * DAV support before they sign in. Whether the org exists is never
 * revealed here — this runs before authentication — so an unknown slug
 * reads exactly like a known one.
 */
function allowFor(pathname: string): string {
  const parsed = parseDavPath(pathname);
  if (parsed === null) return DAV_METHODS;
  if (parsed.isRoot) return READ_ONLY_COLLECTION_METHODS;
  if (parsed.namespace === '.trash') {
    return parsed.isCollection || parsed.segments.length === 0
      ? READ_ONLY_COLLECTION_METHODS
      : TRASH_FILE_METHODS;
  }
  return DAV_METHODS;
}

export function handleOptions(pathname: string): WebDAVResponse {
  return {
    status: 200,
    headers: {
      // Class 2 = supports LOCK / UNLOCK. Some Windows clients refuse
      // to write without Class 2 advertised.
      DAV: '1, 2',
      Allow: allowFor(pathname),
      // Windows-specific opt-in that fixes "WebDAV folders not
      // working" on some older configurations.
      'MS-Author-Via': 'DAV',
      'Microsoft-Server-WebDAV-Extensions': '1',
      'Content-Length': '0',
    },
    body: null,
  };
}
