'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Where the error displays' "contact support" link points by default. */
export const DEFAULT_SUPPORT_URL = 'https://tale.dev/contact';

const SupportUrlContext = createContext<string>(DEFAULT_SUPPORT_URL);
SupportUrlContext.displayName = 'SupportUrlContext';

interface SupportUrlProviderProps {
  /**
   * The support page every error display beneath points at. Unset, the
   * enclosing provider's page (or {@link DEFAULT_SUPPORT_URL}) stays.
   */
  url?: string;
  children: ReactNode;
}

/**
 * Points the "contact support" link of every error display beneath it at the
 * deployment's own support page. A consumer mounts one at its app root; a
 * display's own `supportUrl` prop still wins over it.
 */
export function SupportUrlProvider({ url, children }: SupportUrlProviderProps) {
  const enclosing = useContext(SupportUrlContext);
  return (
    <SupportUrlContext.Provider value={url || enclosing}>
      {children}
    </SupportUrlContext.Provider>
  );
}

/**
 * The support page a display links to: its own `override` when it has one,
 * else the nearest provider's, else {@link DEFAULT_SUPPORT_URL}.
 */
export function useSupportUrl(override?: string): string {
  const provided = useContext(SupportUrlContext);
  return override || provided;
}

/**
 * `url` with the organization as its `organizationId` query parameter, so the
 * support desk knows whose deployment the report came from. The parameter
 * goes last, replacing any `organizationId` the URL already carries; the rest
 * of the query and the fragment are kept as written. Without an organization
 * the URL is returned unchanged.
 */
export function supportUrlFor(url: string, organizationId?: string): string {
  if (!organizationId) return url;
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const params =
    queryAt === -1
      ? []
      : beforeHash
          .slice(queryAt + 1)
          .split('&')
          .filter(
            (param) =>
              param !== '' && param.split('=', 1)[0] !== 'organizationId',
          );
  params.push(`organizationId=${encodeURIComponent(organizationId)}`);
  return `${path}?${params.join('&')}${hash}`;
}
