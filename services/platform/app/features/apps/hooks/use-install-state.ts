'use client';

/**
 * App install lifecycle on the client: a reactive read of per-app install state
 * (`getAppInstallState`) + the install / uninstall / verify actions. The hub
 * uses the state for Install/Installed/Reinstall badges; the app page uses it
 * for the non-blocking readiness checklist.
 */
import { useCallback, useMemo } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export interface AppInstallState {
  appSlug: string;
  status: 'active' | 'broken';
  installedAt: number;
  blockedIntegrations: string[];
}

export function useAppInstallStates(organizationId: string): {
  /** appSlug -> install state (absent = not installed). */
  bySlug: Map<string, AppInstallState>;
  isLoading: boolean;
} {
  const q = useConvexQuery(api.apps.install_queries.getAppInstallState, {
    organizationId,
  });
  const bySlug = useMemo(() => {
    const m = new Map<string, AppInstallState>();
    const rows = (q.data as AppInstallState[] | undefined) ?? [];
    for (const row of rows) m.set(row.appSlug, row);
    return m;
  }, [q.data]);
  return { bySlug, isLoading: q.isLoading };
}

export function useAppInstallActions(organizationId: string): {
  install: (appSlug: string) => Promise<void>;
  uninstall: (appSlug: string) => Promise<void>;
  verify: (appSlug: string) => Promise<void>;
  isPending: boolean;
} {
  const install = useConvexAction(api.apps.install_actions.installApp);
  const uninstall = useConvexAction(api.apps.install_actions.uninstallApp);
  const verify = useConvexAction(api.apps.install_actions.verifyAppIntegrity);

  const run = useCallback(
    (
      mut: {
        mutateAsync: (a: {
          organizationId: string;
          appSlug: string;
        }) => Promise<unknown>;
      },
      appSlug: string,
    ): Promise<void> =>
      mut.mutateAsync({ organizationId, appSlug }).then(() => undefined),
    [organizationId],
  );

  return {
    install: useCallback((s: string) => run(install, s), [run, install]),
    uninstall: useCallback((s: string) => run(uninstall, s), [run, uninstall]),
    verify: useCallback((s: string) => run(verify, s), [run, verify]),
    isPending: install.isPending || uninstall.isPending || verify.isPending,
  };
}
