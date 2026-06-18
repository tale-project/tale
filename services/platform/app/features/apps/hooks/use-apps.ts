import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { ViewConfig } from '@/lib/shared/schemas/views';

/** An app as surfaced in the Apps hub — read from its `app.json` manifest plus
 * its bundled view configs (the configurable pages). */
export interface AppSummary {
  slug: string;
  name: string;
  description: string;
  icon?: string;
  messageNamespace?: string;
  workflows: string[];
  agents: string[];
  views: ViewConfig[];
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
