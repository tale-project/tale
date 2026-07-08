'use client';

/**
 * Automation install lifecycle on the client: a reactive read of per-automation ORG-LEVEL
 * install state (`getAutomationInstallState`) + the install / add-to-project /
 * remove-from-project / reinstall / uninstall / verify actions. The hub uses the
 * state for Install/Installed/Reinstall badges; the org automation page uses it for the
 * readiness checklist; `useAutomationBindings` / `useProjectAutomations` cover project
 * membership.
 */
import { ConvexError } from 'convex/values';
import { useCallback, useMemo } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { asProjectId } from '../../projects/hooks/use-project-id-param';

export interface AutomationInstallState {
  automationSlug: string;
  status: 'active' | 'broken';
  installedAt: number;
  blockedIntegrations: string[];
}

export function useAutomationInstallStates(organizationId: string): {
  /** automationSlug -> ORG-LEVEL install state (absent = not installed). */
  bySlug: Map<string, AutomationInstallState>;
  isLoading: boolean;
} {
  const q = useConvexQuery(
    api.automations.install_queries.getAutomationInstallState,
    {
      organizationId,
    },
  );
  const bySlug = useMemo(() => {
    const m = new Map<string, AutomationInstallState>();
    for (const row of (q.data as AutomationInstallState[] | undefined) ?? []) {
      m.set(row.automationSlug, row);
    }
    return m;
  }, [q.data]);
  return { bySlug, isLoading: q.isLoading };
}

/**
 * A bundle carries no `automationInstallations` row of its own (only its members
 * do) — its install state is always DERIVED from its members':
 *  - `'installed'` — every member has an install row;
 *  - `'partial'` — some but not all do (a distinguishable "needs attention"
 *    state — the operator started the bundle's wizard but skipped members);
 *  - `'broken'` — any installed member's own state is `'broken'`;
 *  - `'not-installed'` — no member has an install row yet.
 */
export type BundleInstallStatus =
  | 'installed'
  | 'partial'
  | 'broken'
  | 'not-installed';

export function deriveBundleInstallStatus(
  memberSlugs: readonly string[],
  bySlug: ReadonlyMap<string, AutomationInstallState>,
): BundleInstallStatus {
  const states = memberSlugs.map((slug) => bySlug.get(slug));
  if (states.some((s) => s?.status === 'broken')) return 'broken';
  if (states.length > 0 && states.every((s) => s != null)) return 'installed';
  if (states.some((s) => s != null)) return 'partial';
  return 'not-installed';
}

/** One automation bound to a project — drives the in-project nav entry. */
export interface ProjectAutomation {
  automationSlug: string;
  automationName: string;
  status: 'active' | 'broken';
}

/** Automations bound to a project (the project-scoped automations installed into it). */
export function useProjectAutomations(projectId: Id<'projects'>): {
  automations: ProjectAutomation[];
  isLoading: boolean;
} {
  const q = useConvexQuery(
    api.automations.install_queries.listProjectAutomations,
    {
      projectId,
    },
  );
  const automations = useMemo(
    () => (q.data as ProjectAutomation[] | undefined) ?? [],
    [q.data],
  );
  return {
    automations,
    isLoading: q.isLoading,
  };
}

/** A project a (project-scoped) automation is bound to — drives the Configuration
 *  tab's projects section (`AutomationProjectsSection`). */
export interface AutomationBinding {
  projectId: string;
  projectName: string;
}

/** The projects a project-scoped automation is bound to (the org automation page's hub). */
export function useAutomationBindings(
  organizationId: string,
  automationSlug: string,
): { bindings: AutomationBinding[]; isLoading: boolean } {
  const q = useConvexQuery(
    api.automations.install_queries.listAutomationBindings,
    {
      organizationId,
      automationSlug: automationSlug,
    },
  );
  return {
    bindings: (q.data as AutomationBinding[] | undefined) ?? [],
    isLoading: q.isLoading,
  };
}

/** One planned install file with its preflight verdict (server-computed). */
export interface AutomationInstallPreviewEntry {
  /** `'automation'` (bundle shell) or a fan-out domain (`integrations`, `skills`). */
  domain: string;
  path: string;
  /** manifest | icon | agent | view | message | asset | integration | skill */
  kind: string;
  slug?: string;
  status: string;
}

/** The install preflight: every planned file + the override keys to confirm. */
export interface AutomationInstallPreview {
  entries: AutomationInstallPreviewEntry[];
  /** Preflight keys (`domain:path`) of files the install would OVERWRITE. */
  overrides: string[];
}

export function useAutomationInstallActions(organizationId: string): {
  /**
   * Install an automation, or add an already-installed project-scoped automation to another
   * project. `projectId` is required for project-scoped automations, rejected for
   * org-scoped. `confirmedOverrides` carries the preview's override keys the
   * operator approved; a current override missing from it rejects with
   * `AUTOMATION_INSTALL_OVERRIDES` before any file is written.
   */
  install: (
    automationSlug: string,
    projectId?: string,
    confirmedOverrides?: readonly string[],
  ) => Promise<void>;
  /** Preflight: what installing/reinstalling would create/keep/overwrite. */
  preview: (automationSlug: string) => Promise<AutomationInstallPreview>;
  /** Remove ONE project binding (project-membership action; never tears down). */
  removeFromProject: (
    automationSlug: string,
    projectId: string,
  ) => Promise<void>;
  /** Re-sync org resources (project-agnostic). Same override contract as install. */
  reinstall: (
    automationSlug: string,
    confirmedOverrides?: readonly string[],
  ) => Promise<void>;
  /** Org-wide teardown — refused server-side while any project is still bound. */
  uninstall: (automationSlug: string) => Promise<void>;
  /** Bundle teardown: drops every member's project bindings, then uninstalls
   *  each member (reverse install order). */
  uninstallBundle: (bundleSlug: string) => Promise<void>;
  verify: (automationSlug: string) => Promise<void>;
  isPending: boolean;
} {
  const install = useConvexAction(
    api.automations.install_actions.installAutomation,
  );
  const preview = useConvexAction(
    api.automations.install_actions.previewAutomationInstall,
  );
  const reinstall = useConvexAction(
    api.automations.install_actions.reinstallAutomation,
  );
  const removeFromProject = useConvexAction(
    api.automations.install_actions.removeAutomationFromProject,
  );
  const uninstall = useConvexAction(
    api.automations.install_actions.uninstallAutomation,
  );
  const uninstallBundle = useConvexAction(
    api.automations.install_bundle_actions.uninstallBundle,
  );
  const verify = useConvexAction(
    api.automations.install_actions.verifyAutomationIntegrity,
  );

  return {
    install: useCallback(
      (s: string, projectId?: string, confirmedOverrides?: readonly string[]) =>
        install
          .mutateAsync({
            organizationId,
            automationSlug: s,
            ...(projectId !== undefined && {
              projectId: asProjectId(projectId),
            }),
            ...(confirmedOverrides !== undefined && {
              confirmedOverrides: [...confirmedOverrides],
            }),
          })
          .then(() => undefined),
      [install, organizationId],
    ),
    preview: useCallback(
      (s: string) =>
        preview.mutateAsync({
          organizationId,
          automationSlug: s,
        }) as Promise<AutomationInstallPreview>,
      [preview, organizationId],
    ),
    removeFromProject: useCallback(
      (s: string, projectId: string) =>
        removeFromProject
          .mutateAsync({
            organizationId,
            automationSlug: s,
            projectId: asProjectId(projectId),
          })
          .then(() => undefined),
      [removeFromProject, organizationId],
    ),
    reinstall: useCallback(
      (s: string, confirmedOverrides?: readonly string[]) =>
        reinstall
          .mutateAsync({
            organizationId,
            automationSlug: s,
            ...(confirmedOverrides !== undefined && {
              confirmedOverrides: [...confirmedOverrides],
            }),
          })
          .then(() => undefined),
      [reinstall, organizationId],
    ),
    uninstall: useCallback(
      (s: string) =>
        uninstall
          .mutateAsync({ organizationId, automationSlug: s })
          .then(() => undefined),
      [uninstall, organizationId],
    ),
    uninstallBundle: useCallback(
      (bundleSlug: string) =>
        uninstallBundle
          .mutateAsync({ organizationId, bundleSlug })
          .then(() => undefined),
      [uninstallBundle, organizationId],
    ),
    verify: useCallback(
      (s: string) =>
        verify
          .mutateAsync({ organizationId, automationSlug: s })
          .then(() => undefined),
      [verify, organizationId],
    ),
    isPending:
      install.isPending ||
      preview.isPending ||
      removeFromProject.isPending ||
      reinstall.isPending ||
      uninstall.isPending ||
      uninstallBundle.isPending ||
      verify.isPending,
  };
}

/** One bundle member's install preflight — {@link AutomationInstallPreview}
 *  plus the display fields the wizard needs for a HIDDEN member (it never
 *  appears in `listAutomations`/`listCatalogAutomations`, so this is its only pre-install
 *  read). */
export interface BundleMemberInstallPreview extends AutomationInstallPreview {
  automationSlug: string;
  automationName: string;
  /** This member's own `requires.integrations` — union these across members
   *  for the bundle wizard's deduped connect steps. */
  requiredIntegrations: string[];
}

/**
 * Bundle install actions — the aggregated twin of
 * {@link useAutomationInstallActions}. `previewBundle` returns one preflight
 * per member (`installBundle` groups its review step by member); `install`
 * calls `installBundle` ONCE with every member's confirmed overrides,
 * namespaced by member slug (`confirmedOverridesByAutomation`).
 */
export function useBundleInstallActions(organizationId: string): {
  previewBundle: (bundleSlug: string) => Promise<BundleMemberInstallPreview[]>;
  install: (
    bundleSlug: string,
    projectId?: string,
    confirmedOverridesByAutomation?: Readonly<
      Record<string, readonly string[]>
    >,
  ) => Promise<{
    ok: boolean;
    members: Array<{
      automationSlug: string;
      ok: boolean;
      error?: string;
    }>;
  }>;
  isPending: boolean;
} {
  const preview = useConvexAction(
    api.automations.install_bundle_actions.previewBundleInstall,
  );
  const install = useConvexAction(
    api.automations.install_bundle_actions.installBundle,
  );

  return {
    previewBundle: useCallback(
      async (s: string) => {
        const rows = await preview.mutateAsync({
          organizationId,
          bundleSlug: s,
        });
        return rows as BundleMemberInstallPreview[];
      },
      [preview, organizationId],
    ),
    install: useCallback(
      (
        s: string,
        projectId?: string,
        confirmedOverridesByAutomation?: Readonly<
          Record<string, readonly string[]>
        >,
      ) =>
        install
          .mutateAsync({
            organizationId,
            bundleSlug: s,
            ...(projectId !== undefined && {
              projectId: asProjectId(projectId),
            }),
            ...(confirmedOverridesByAutomation !== undefined && {
              confirmedOverridesByAutomation: Object.fromEntries(
                Object.entries(confirmedOverridesByAutomation).map(([k, v]) => [
                  k,
                  [...v],
                ]),
              ),
            }),
          })
          .then((result) => ({
            ok: result.ok,
            members: result.members,
          })),
      [install, organizationId],
    ),
    isPending: preview.isPending || install.isPending,
  };
}

/**
 * Narrow an action error to the `AUTOMATION_INSTALL_OVERRIDES` rejection thrown when
 * an install/reinstall would overwrite files the caller hasn't confirmed
 * (a race: the disk changed after the preview). The shared shape lets every
 * confirm surface (wizard, reinstall dialog) branch on it identically.
 */
export function isInstallOverridesError(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    data.code === 'AUTOMATION_INSTALL_OVERRIDES'
  );
}
