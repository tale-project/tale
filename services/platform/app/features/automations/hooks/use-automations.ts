import { useQueryClient } from '@tanstack/react-query';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';
import type {
  AutomationConfigField,
  AutomationTabDoc,
  AutomationViewDoc,
} from '@/lib/shared/schemas/automation_views';
import type {
  AutomationBuiltinView,
  AutomationManifestI18n,
  AutomationScope,
} from '@/lib/shared/schemas/automations';

// The view/tab/config-field shapes are `z.infer` re-exports of the automation-view
// schema (`lib/shared/schemas/automation_views.ts`) — one source of truth, no
// schema↔runtime drift. Re-exported here so feature code keeps its import site.
export type { AutomationConfigField, AutomationTabDoc, AutomationViewDoc };

/**
 * A view that failed validation at discovery — `listAutomations` surfaces it in place
 * of the view (never a silent drop) so the automation page can render a repair
 * affordance while every valid view keeps working. `id` is the view id the doc
 * declared (or its filename stem).
 */
export interface AutomationViewErrorStub {
  id: string;
  error: { code: string; message: string };
}

/** Whether a `views` entry is an error stub rather than a renderable view. */
export function isAutomationViewErrorStub(
  view: AutomationViewDoc | AutomationViewErrorStub,
): view is AutomationViewErrorStub {
  return (
    'error' in view && typeof view.error === 'object' && view.error !== null
  );
}

/** An automation as surfaced in the Automations catalog — read from its `automation.json` manifest plus
 * its bundled Puck view documents + its function allowlist. */
export interface AutomationSummary {
  slug: string;
  name: string;
  description: string;
  /**
   * The manifest's inline per-locale display overrides (`manifest.i18n`) —
   * automations translate themselves. Render name/description/config labels
   * through `useAutomationDisplay` / `useConfigFieldText`
   * (`hooks/use-automation-text.ts`), never the literals directly.
   */
  i18n?: AutomationManifestI18n;
  /** Install/runtime scope declared in the manifest (absent ⇒ 'org'). */
  scope: AutomationScope;
  /** A bundle's member — never gets its own catalog card, but its detail
   *  page (the workflow settings) resolves like any installed automation. */
  hidden?: boolean;
  /** Lucide icon name from the manifest — the fallback when no `iconUrl`. */
  icon?: string;
  /** The bundled `icon.svg` as a data URI; preferred over `icon`. */
  iconUrl?: string;
  /**
   * Display folder from the manifest ('/'-separated, e.g. `github/issues`).
   * The hub groups its catalog sections by the top-level segment; absent means
   * ungrouped (the trailing "General" section once any folder exists).
   */
  folder?: string;
  /**
   * Catalog chips from the manifest (`labels`) — short literal display strings
   * (e.g. "GitHub", "Email") shown on the hub card and the details header.
   */
  labels?: string[];
  /**
   * `'bundle'` when the manifest declares `bundle.members` — installing it
   * installs each member through one aggregated wizard
   * (`install-wizard/bundle-install-wizard.tsx`); `'automation'` otherwise
   * (the ordinary single-automation install flow). See `automations.ts#automationManifestSchema`.
   */
  kind: 'automation' | 'bundle';
  /** Member automation slugs, in declared install order — only on `kind: 'bundle'`. */
  members?: string[];
  /** role token -> composite agent slug (the manifest's cast). */
  roles?: Record<string, string>;
  /**
   * Subject contracts from the manifest (`subjects`) — how tasks this
   * automation OWNS are operated from generic surfaces. Carried raw; consumers
   * parse `subjects.task` through `taskSubjectContractSchema` (tolerant:
   * an invalid contract reads as none).
   */
  subjects?: { task?: unknown };
  workflows: string[];
  agents: string[];
  /**
   * Skill slugs the automation ships (`manifest.skills`) — a display declaration
   * mirroring `agents`; the bundle fan-out copies whatever `skills/` carries.
   */
  skills: string[];
  /** capabilities.functions — the views' allowed Convex calls. */
  functions: FunctionBinding[];
  /**
   * Integration slugs the automation declares it needs (`requires.integrations`). Lets
   * the hub decide, before install, whether to route through the connect wizard.
   */
  requiredIntegrations: string[];
  /** Renderable view docs, with invalid ones surfaced as error stubs in place. */
  views: (AutomationViewDoc | AutomationViewErrorStub)[];
  /**
   * Platform-rendered views the manifest opts into (`builtinViews`) — rendered
   * by the automation page before any bundled JSON views, via the client registry in
   * `builtin-views/registry.tsx`.
   */
  builtinViews?: AutomationBuiltinView[];
}

/** Refetch the hub's automation list after a bundle-changing action (e.g. builtin sync). */
export function useInvalidateAutomations() {
  const queryClient = useQueryClient();
  return (organizationId: string) =>
    queryClient.invalidateQueries({
      queryKey: ['automations', 'list', organizationId],
    });
}

export function useAutomations(organizationId: string): {
  automations: AutomationSummary[];
  isLoading: boolean;
  error: Error | null;
} {
  const q = useActionQuery(
    ['automations', 'list', organizationId],
    api.automations.file_actions.listAutomations,
    { organizationId },
  );
  return {
    automations: (q.data as AutomationSummary[] | undefined) ?? [],
    isLoading: q.isLoading,
    error: q.error,
  };
}

/**
 * The built-in automation CATALOG — every installable automation, whether or not it is already
 * installed into this org. The Automations catalog unions this with {@link useAutomations} so a
 * fresh org can discover and install automations from the UI (the not-yet-installed
 * ones show an Install button). Catalog summaries carry no `views` — those
 * materialize once an automation is copied into the org and are read via
 * {@link useAutomations}.
 */
export function useAutomationCatalog(organizationId: string): {
  automations: AutomationSummary[];
  isLoading: boolean;
  error: Error | null;
} {
  const q = useActionQuery(
    ['automations', 'catalog', organizationId],
    api.automations.file_actions.listCatalogAutomations,
    { organizationId },
  );
  return {
    automations: (q.data as AutomationSummary[] | undefined) ?? [],
    isLoading: q.isLoading,
    error: q.error,
  };
}

/** A bundle member's display summary — {@link useBundleMemberSummaries}. */
export interface BundleMemberSummary {
  slug: string;
  name: string;
  description: string;
  /** The member's declared integration dependencies — the bundle panel
   *  aggregates these into its own Integrations section. */
  requiredIntegrations: string[];
}

/**
 * Name + description for a bundle's member slugs — the bundle catalog
 * panel's "what's inside" read. Members are HIDDEN (never in
 * {@link useAutomations}/{@link useAutomationCatalog}), so this is their
 * only pre-install summary; backed by `getAutomationSummariesBySlug`, which is
 * safe to call with these slugs because the bundle's own catalog entry
 * already discloses them (`AutomationSummary.members`).
 */
export function useBundleMemberSummaries(
  organizationId: string,
  memberSlugs: readonly string[],
): { members: BundleMemberSummary[]; isLoading: boolean } {
  const q = useActionQuery(
    ['automations', 'bundle-member-summaries', organizationId, ...memberSlugs],
    api.automations.file_actions.getAutomationSummariesBySlug,
    { organizationId, slugs: [...memberSlugs] },
    { enabled: memberSlugs.length > 0 },
  );
  return {
    members: (q.data as BundleMemberSummary[] | undefined) ?? [],
    isLoading: q.isLoading,
  };
}
