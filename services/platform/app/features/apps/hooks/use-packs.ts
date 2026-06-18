import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { ViewConfig } from '@/lib/shared/schemas/views';

/** A pack as surfaced in the Apps hub — an installed skill with a `pack`
 * manifest, plus its bundled view configs (the configurable pages). */
export interface PackSummary {
  slug: string;
  name: string;
  description: string;
  messageNamespace: string;
  views: ViewConfig[];
}

export function usePacks(organizationId: string): {
  packs: PackSummary[];
  isLoading: boolean;
  error: Error | null;
} {
  const q = useActionQuery(
    ['apps', 'packs', organizationId],
    api.skills.pack_actions.listPacks,
    { organizationId },
  );
  return {
    packs: (q.data as PackSummary[] | undefined) ?? [],
    isLoading: q.isLoading,
    error: q.error,
  };
}
