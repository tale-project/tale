import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/**
 * Read the deployment vector-database config + masked secret state. Cached via
 * TanStack Query under the `['config','vectordb', organizationId]` key so the
 * save mutations can invalidate it.
 */
export function useReadVectorDbConfig(
  organizationId: string,
  options?: { enabled?: boolean },
) {
  return useActionQuery(
    ['config', 'vectordb', organizationId],
    api.vectordb.file_actions.readVectorDbConfig,
    { organizationId },
    options,
  );
}
