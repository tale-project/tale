import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useMcpServers(organizationId: string) {
  return useConvexQuery(api.mcp_servers.queries.list, { organizationId });
}

export function useMcpServer(id: string) {
  return useConvexQuery(
    api.mcp_servers.queries.getById,
    // @ts-expect-error -- Convex Id<'mcpServers'> branded type requires string cast
    { id },
  );
}
