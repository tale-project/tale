import { useSyncExternalStore } from 'react';

/**
 * Tiny module-level store for the dashboard's active organization id.
 *
 * `BrandingProvider` is mounted ABOVE the router (it themes the whole app,
 * including the pre-auth shell), so it can't read the route's `$id` param via
 * a hook. The dashboard layout — which DOES know the org from its route — pushes
 * the active org here, and the provider subscribes through `useSyncExternalStore`
 * to fetch and apply that org's branding. Outside the dashboard (login, org
 * switcher) the id is `undefined`, so branding falls back to the platform
 * default bucket.
 */
let activeOrganizationId: string | undefined;
const listeners = new Set<() => void>();

export function setActiveOrganizationId(id: string | undefined): void {
  if (id === activeOrganizationId) return;
  activeOrganizationId = id;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | undefined {
  return activeOrganizationId;
}

export function useActiveOrganizationId(): string | undefined {
  // Same function for client + server snapshot: the value is always `undefined`
  // on the server (this is a client-only SPA), so there's no hydration skew.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
