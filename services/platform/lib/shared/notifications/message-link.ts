/**
 * The link an automation's message may carry — read the same way where the
 * step writes it, where the bell and the REST list open it, and where the
 * email puts it behind its button.
 *
 * Two kinds, nothing else: a page of the organization's own Tale
 * (`/dashboard/<organization>/…`), which opens in place, or a public `https://`
 * address, which opens in a new tab and says which site it is. Anything that
 * could leave the page somewhere unexpected is refused rather than mended: a
 * protocol-relative or backslashed path, a `.`/`..` segment, an empty
 * segment, a path into another organization, credentials in the address, a
 * fragment on an in-app path, plaintext `http:`, `javascript:` and every
 * other scheme.
 */

/** The longest link a message may carry, in characters. */
export const MESSAGE_LINK_MAX_LENGTH = 2000;

export type MessageLink =
  /** A page of this organization: `path` (with its query, without a
   * trailing slash) for an absolute URL, `splat` (the path after the
   * organization) and `search` for the router's catch-all target — both
   * spell the same page. */
  | {
      kind: 'app';
      path: string;
      splat: string;
      search: Record<string, string>;
    }
  /** A public web page, normalized, and the host it names. */
  | { kind: 'web'; url: string; host: string };

/** An origin no deployment answers on, to resolve in-app paths against. */
const PROBE_ORIGIN = 'https://tale.invalid';

function appLink(link: string, organizationId: string): MessageLink | null {
  if (/[\\\s#]/.test(link)) return null;
  let url: URL;
  try {
    url = new URL(link, PROBE_ORIGIN);
  } catch {
    return null;
  }
  // A path the resolver had to rewrite (a dot segment, an escape it
  // re-encoded) is not the page it looks like.
  if (url.origin !== PROBE_ORIGIN || url.pathname !== link.split('?')[0]) {
    return null;
  }
  const [, root, organization, ...rest] = url.pathname.split('/');
  if (root !== 'dashboard' || organization !== organizationId) return null;
  const segments = rest.at(-1) === '' ? rest.slice(0, -1) : rest;
  if (segments.some((segment) => segment === '')) return null;
  const splat = segments.join('/');
  const search = Object.fromEntries(url.searchParams);
  const query = new URLSearchParams(search).toString();
  return {
    kind: 'app',
    path: `/dashboard/${organization}${splat === '' ? '' : `/${splat}`}${query === '' ? '' : `?${query}`}`,
    splat,
    search,
  };
}

function webLink(link: string): MessageLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '') return null;
  if (url.username !== '' || url.password !== '') return null;
  return { kind: 'web', url: url.href, host: url.host };
}

/**
 * What `link` opens for a member of `organizationId`, or null when it is not
 * a link a message may carry.
 */
export function classifyMessageLink(
  link: unknown,
  organizationId: string,
): MessageLink | null {
  if (typeof link !== 'string') return null;
  const trimmed = link.trim();
  if (trimmed === '' || trimmed.length > MESSAGE_LINK_MAX_LENGTH) return null;
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? null : appLink(trimmed, organizationId);
  }
  return webLink(trimmed);
}
