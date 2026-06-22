'use client';

/**
 * App install lifecycle on the client: a reactive read of per-app ORG-LEVEL
 * install state (`getAppInstallState`) + the install / add-to-project /
 * remove-from-project / reinstall / uninstall / verify actions. The hub uses the
 * state for Install/Installed/Reinstall badges; the org app page uses it for the
 * readiness checklist; `useAppBindings` / `useProjectApps` cover project
 * membership.
 */
import { useCallback, useMemo } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { asProjectId } from '../../projects/hooks/use-project-id-param';

export interface AppInstallState {
  appSlug: string;
  status: 'active' | 'broken';
  installedAt: number;
  blockedIntegrations: string[];
}

export function useAppInstallStates(organizationId: string): {
  /** appSlug -> ORG-LEVEL install state (absent = not installed). */
  bySlug: Map<string, AppInstallState>;
  isLoading: boolean;
} {
  const q = useConvexQuery(api.apps.install_queries.getAppInstallState, {
    organizationId,
  });
  const bySlug = useMemo(() => {
    const m = new Map<string, AppInstallState>();
    for (const row of (q.data as AppInstallState[] | undefined) ?? []) {
      m.set(row.appSlug, row);
    }
    return m;
  }, [q.data]);
  return { bySlug, isLoading: q.isLoading };
}

/** One app bound to a project — drives the in-project nav entry. */
export interface ProjectApp {
  appSlug: string;
  appName: string;
  status: 'active' | 'broken';
}

/** Apps bound to a project (the project-scoped apps installed into it). */
export function useProjectApps(projectId: Id<'projects'>): {
  apps: ProjectApp[];
  isLoading: boolean;
} {
  const q = useConvexQuery(api.apps.install_queries.listProjectApps, {
    projectId,
  });
  return {
    apps: (q.data as ProjectApp[] | undefined) ?? [],
    isLoading: q.isLoading,
  };
}

/** A project a (project-scoped) app is bound to — drives the membership hub. */
export interface AppBinding {
  projectId: string;
  projectName: string;
}

/** The projects a project-scoped app is bound to (the org app page's hub). */
export function useAppBindings(
  organizationId: string,
  appSlug: string,
): { bindings: AppBinding[]; isLoading: boolean } {
  const q = useConvexQuery(api.apps.install_queries.listAppBindings, {
    organizationId,
    appSlug,
  });
  return {
    bindings: (q.data as AppBinding[] | undefined) ?? [],
    isLoading: q.isLoading,
  };
}

export function useAppInstallActions(organizationId: string): {
  /**
   * Install an app, or add an already-installed project-scoped app to another
   * project. `projectId` is required for project-scoped apps, rejected for
   * org-scoped.
   */
  install: (appSlug: string, projectId?: string) => Promise<void>;
  /** Remove ONE project binding (project-membership action; never tears down). */
  removeFromProject: (appSlug: string, projectId: string) => Promise<void>;
  /** Re-sync org resources (project-agnostic). */
  reinstall: (appSlug: string) => Promise<void>;
  /** Org-wide teardown — refused server-side while any project is still bound. */
  uninstall: (appSlug: string) => Promise<void>;
  verify: (appSlug: string) => Promise<void>;
  isPending: boolean;
} {
  const install = useConvexAction(api.apps.install_actions.installApp);
  const reinstall = useConvexAction(api.apps.install_actions.reinstallApp);
  const removeFromProject = useConvexAction(
    api.apps.install_actions.removeAppFromProject,
  );
  const uninstall = useConvexAction(api.apps.install_actions.uninstallApp);
  const verify = useConvexAction(api.apps.install_actions.verifyAppIntegrity);

  return {
    install: useCallback(
      (s: string, projectId?: string) =>
        install
          .mutateAsync({
            organizationId,
            appSlug: s,
            ...(projectId !== undefined && {
              projectId: asProjectId(projectId),
            }),
          })
          .then(() => undefined),
      [install, organizationId],
    ),
    removeFromProject: useCallback(
      (s: string, projectId: string) =>
        removeFromProject
          .mutateAsync({
            organizationId,
            appSlug: s,
            projectId: asProjectId(projectId),
          })
          .then(() => undefined),
      [removeFromProject, organizationId],
    ),
    reinstall: useCallback(
      (s: string) =>
        reinstall
          .mutateAsync({ organizationId, appSlug: s })
          .then(() => undefined),
      [reinstall, organizationId],
    ),
    uninstall: useCallback(
      (s: string) =>
        uninstall
          .mutateAsync({ organizationId, appSlug: s })
          .then(() => undefined),
      [uninstall, organizationId],
    ),
    verify: useCallback(
      (s: string) =>
        verify
          .mutateAsync({ organizationId, appSlug: s })
          .then(() => undefined),
      [verify, organizationId],
    ),
    isPending:
      install.isPending ||
      removeFromProject.isPending ||
      reinstall.isPending ||
      uninstall.isPending ||
      verify.isPending,
  };
}
