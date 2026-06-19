import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';

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
  icon?: string;
  messageNamespace?: string;
  workflows: string[];
  agents: string[];
  /** capabilities.functions — the views' allowed Convex calls. */
  functions: FunctionBinding[];
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
