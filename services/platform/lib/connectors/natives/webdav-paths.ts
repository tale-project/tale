/**
 * Path safety for the native WebDAV actions — the one place a caller-supplied
 * path becomes a list of names inside ONE organization's file tree.
 *
 * An action's `path` is arbitrary text an agent or an automation wrote, so it is
 * treated as hostile. The parse refuses `..` and `.`, an empty segment, a NUL
 * or any control character, and a Windows separator; and it NEVER
 * percent-decodes, because decoding is exactly what turns `%2e%2e` back into a
 * traversal (a real file name containing `%` is just a name). What survives is
 * a list of plain names that can only address a descendant of the
 * organization's root.
 *
 * The organization is never taken from the input: a path names a place inside
 * a tree, never which tenant's tree, so the caller's `ctx.organizationId` is
 * the only organization the store is ever asked about. A path that looks like
 * another org's URL is therefore just a folder name here, and a path that
 * tries to climb out is refused rather than reinterpreted.
 *
 * Names are validated with the same rule the platform's `/dav` server applies
 * at its wire boundary, so a path these actions accept is a path the DAV
 * surface accepts too — one grammar, not a second dialect that could reach a
 * resource the DAV server itself cannot.
 */

import { isValidSegment } from '../../webdav/paths';

/**
 * Depth ceiling for an addressed path. The document store refuses folders
 * nested deeper than 20, so a deeper path can only ever be a typo or a probe;
 * refusing it here keeps the message specific instead of surfacing a store
 * conflict.
 */
const MAX_SEGMENTS = 20;

/** Whole-path ceiling — long enough for any real tree, short enough that a
 * generated path cannot become a denial-of-service payload. */
const MAX_PATH_LENGTH = 1024;

export type OrgPath =
  | { readonly ok: true; readonly segments: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse a caller-supplied path into the segments addressing it.
 *
 * `/` (or `''`) is the organization's root and yields no segments; every other
 * accepted path is a strict descendant of it. The refusal `reason` names what
 * was wrong so the action can hand the caller something actionable.
 */
export function parseOrgPath(raw: unknown): OrgPath {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'path must be a string' };
  }
  if (raw.length > MAX_PATH_LENGTH) {
    return {
      ok: false,
      reason: `path is longer than ${MAX_PATH_LENGTH} characters`,
    };
  }
  if (raw.includes('\0')) {
    return { ok: false, reason: 'path contains a NUL character' };
  }

  const trimmed = raw.trim();
  // A URL is not a path in this tree. Accepting one would quietly create a
  // folder called "https:" instead of telling the caller it addressed the
  // wrong thing.
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    return { ok: false, reason: 'path is a URL, not a path inside the tree' };
  }
  // `//host/share` is an authority, not a root-relative path; the two forms
  // mean different places and only one of them exists here.
  if (trimmed.startsWith('//')) {
    return { ok: false, reason: 'path starts with an authority ("//")' };
  }
  // Leading and trailing slashes are notation, not content: `/reports`,
  // `reports`, and `/reports/` all name the same folder. An interior empty
  // segment (`//`) is malformed and refused below rather than quietly
  // collapsed, so a caller never gets a path it did not write.
  const body = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
  if (body === '') return { ok: true, segments: [] };

  const segments: string[] = [];
  for (const rawSegment of body.split('/')) {
    // NFC first, matching the DAV wire boundary: macOS clients send decomposed
    // unicode, everyone else composed, and the store indexes the composed
    // form — without this the same name from two clients would be two rows.
    const segment = rawSegment.normalize('NFC').trim();
    if (segment === '') {
      return { ok: false, reason: 'path contains an empty segment' };
    }
    if (segment === '.' || segment === '..') {
      return {
        ok: false,
        reason: `path contains the traversal segment "${segment}"`,
      };
    }
    if (!isValidSegment(segment)) {
      return {
        ok: false,
        reason: `path segment "${segment.slice(0, 60)}" is not a usable name`,
      };
    }
    segments.push(segment);
  }

  if (segments.length > MAX_SEGMENTS) {
    return { ok: false, reason: `path is deeper than ${MAX_SEGMENTS} levels` };
  }
  return { ok: true, segments };
}

/** The canonical spelling of a parsed path — leading slash, no trailing one,
 * `/` for the organization's root. What the actions echo back to the caller. */
export function formatOrgPath(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** The canonical path of one entry directly inside `segments`. */
export function formatChildPath(
  segments: readonly string[],
  name: string,
): string {
  return segments.length === 0 ? `/${name}` : `/${segments.join('/')}/${name}`;
}
