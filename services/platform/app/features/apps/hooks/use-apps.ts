import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';
import type { AppScope } from '@/lib/shared/schemas/apps';

/** One declared per-install config key from an app manifest's `requires.config`
 *  (e.g. `{ key: 'repository', type: 'string', labelKey: 'issueDesk.config.repository' }`). */
export interface AppConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean';
  labelKey: string;
  /** Optional input placeholder (pack-label key) — a format hint. */
  placeholderKey?: string;
  /** Optional one-input → many-keys derivation: the entered string is split by
   *  `pattern` into the `into` keys (e.g. `owner`/`repo`) on save. The field's
   *  own key keeps the raw input for read-back; the views bind the split keys. */
  derive?: { pattern: string; into: string[] };
}

/** A navigable area of a view — its content is single-column Puck Data, or a
 *  `columns` array of Puck Data documents laid out side by side. */
export interface AppTabDoc {
  id: string;
  label: string;
  data?: unknown;
  columns?: unknown[];
}

/** One page of an app. Either a flat Puck Data document (`data`) or a tabbed
 *  shell (`tabs`) — the structural layout, navigated rather than scrolled. */
export interface AppViewDoc {
  id: string;
  title?: string;
  description?: string;
  /** Puck Data ({ content, root, zones }) for a flat (untabbed) view. */
  data?: unknown;
  tabs?: AppTabDoc[];
}

/** An app as surfaced in the Apps hub — read from its `app.json` manifest plus
 * its bundled Puck view documents + its function allowlist. */
export interface AppSummary {
  slug: string;
  name: string;
  description: string;
  /** Install/runtime scope declared in the manifest (absent ⇒ 'org'). */
  scope: AppScope;
  icon?: string;
  messageNamespace?: string;
  workflows: string[];
  agents: string[];
  /** capabilities.functions — the views' allowed Convex calls. */
  functions: FunctionBinding[];
  /**
   * Integration slugs the app declares it needs (`requires.integrations`). Lets
   * the hub decide, before install, whether to route through the connect wizard.
   */
  requiredIntegrations: string[];
  /**
   * Per-install config keys the app declares (`requires.config`) — e.g. a GitHub
   * `owner`/`repo`. Drives the app's config form; the values are stored on the
   * install row and read by views via the `$config:` binding token.
   */
  requiredConfig: AppConfigField[];
  views: AppViewDoc[];
  /**
   * The app's own pack-authored label catalogs (`messages/<locale>.json`),
   * locale -> flat `{ labelKey: string }` map. Used to resolve `ui.labelKey`
   * references (e.g. friendly workflow-step names) at render time.
   */
  messages?: Record<string, Record<string, string>>;
}

export function useApps(organizationId: string): {
  apps: AppSummary[];
  isLoading: boolean;
  error: Error | null;
} {
  const q = useActionQuery(
    ['apps', 'list', organizationId],
    api.apps.file_actions.listApps,
    { organizationId },
  );
  return {
    apps: (q.data as AppSummary[] | undefined) ?? [],
    isLoading: q.isLoading,
    error: q.error,
  };
}

/**
 * The built-in app CATALOG — every installable app, whether or not it is already
 * installed into this org. The Apps hub unions this with {@link useApps} so a
 * fresh org can discover and install apps from the UI (the not-yet-installed
 * ones show an Install button). Catalog summaries carry no `views`/`messages` —
 * those materialize once an app is copied into the org and are read via
 * {@link useApps} / {@link useAppPackLabels}.
 */
export function useAppCatalog(organizationId: string): {
  apps: AppSummary[];
  isLoading: boolean;
  error: Error | null;
} {
  const q = useActionQuery(
    ['apps', 'catalog', organizationId],
    api.apps.file_actions.listCatalogApps,
    { organizationId },
  );
  return {
    apps: (q.data as AppSummary[] | undefined) ?? [],
    isLoading: q.isLoading,
    error: q.error,
  };
}
