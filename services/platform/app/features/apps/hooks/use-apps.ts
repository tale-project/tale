import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';

/** One page of an app — a Puck Data document with an id/title. */
export interface AppViewDoc {
  id: string;
  title?: string;
  /** Puck Data ({ content, root, zones }). */
  data: unknown;
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
