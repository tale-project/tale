import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';
import type {
  OrgChartNode,
  OrgChartPayload,
} from '@/convex/agents/org_chart_actions';

export const orgChartKey = (organizationId: string) =>
  ['org-chart', organizationId] as const;

/** The post-build delegation graph + per-node guardrail snapshots. */
export function useOrgChart(organizationId: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    orgChartKey(organizationId),
    api.agents.org_chart_actions.getOrgChart,
    { organizationId },
    { enabled: !!organizationId },
  );
  // The action returns v.any(); the payload shape is owned by getOrgChart.
  const chart: OrgChartPayload | undefined = data ?? undefined;
  return { chart, isLoading, error, refetch };
}

/**
 * Recompute each node's derived incoming edges (`parentSlugs` + the primary
 * `managerSlug`) from the authoritative outgoing edges (`directReports`) — so
 * an optimistic edit to one side stays internally consistent before the
 * server round-trip settles.
 */
function recomputeDerived(nodes: OrgChartNode[]): OrgChartNode[] {
  const parentsBySlug = new Map<string, string[]>();
  for (const node of nodes) {
    for (const child of node.directReports) {
      if (child === node.slug) continue;
      const list = parentsBySlug.get(child) ?? [];
      if (!list.includes(node.slug)) list.push(node.slug);
      parentsBySlug.set(child, list);
    }
  }
  return nodes.map((node) => {
    const parents = (parentsBySlug.get(node.slug) ?? []).slice().sort();
    return { ...node, parentSlugs: parents, managerSlug: parents[0] };
  });
}

function applyOptimistic(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  mutateNodes: (nodes: OrgChartNode[]) => OrgChartNode[],
) {
  const key = orgChartKey(organizationId);
  const previous = queryClient.getQueryData<OrgChartPayload>(key);
  if (previous) {
    queryClient.setQueryData<OrgChartPayload>(key, {
      ...previous,
      nodes: recomputeDerived(mutateNodes(previous.nodes)),
    });
  }
  return previous;
}

const dedupeSorted = (slugs: string[]) => [...new Set(slugs)].sort();

/**
 * Set the agents one agent delegates to (its outgoing edges / direct
 * reports). Optimistically rewrites the cached chart; rolls back on error
 * (the error toast is the caller's job — it has the i18n context).
 */
export function useSetAgentDelegates(organizationId: string) {
  const queryClient = useQueryClient();
  const setDelegates = useConvexAction(
    api.agents.org_chart_actions.setAgentDelegates,
  );
  return useMutation({
    mutationFn: (args: { agentSlug: string; delegateSlugs: string[] }) =>
      setDelegates.mutateAsync({ organizationId, ...args }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({
        queryKey: orgChartKey(organizationId),
      });
      return {
        previous: applyOptimistic(queryClient, organizationId, (nodes) =>
          nodes.map((node) =>
            node.slug === args.agentSlug
              ? { ...node, directReports: dedupeSorted(args.delegateSlugs) }
              : node,
          ),
        ),
      };
    },
    onError: (_error, _args, context) => {
      if (context?.previous) {
        queryClient.setQueryData(orgChartKey(organizationId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: orgChartKey(organizationId),
      });
    },
  });
}

/**
 * Set the agents that delegate to one agent (its incoming edges / the
 * "reports to" list), by adjusting each parent's direct reports. Optimistic +
 * rollback, same contract as {@link useSetAgentDelegates}.
 */
export function useSetAgentParents(organizationId: string) {
  const queryClient = useQueryClient();
  const setParents = useConvexAction(
    api.agents.org_chart_actions.setAgentParents,
  );
  return useMutation({
    mutationFn: (args: { agentSlug: string; parentSlugs: string[] }) =>
      setParents.mutateAsync({ organizationId, ...args }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({
        queryKey: orgChartKey(organizationId),
      });
      const desired = new Set(args.parentSlugs);
      return {
        previous: applyOptimistic(queryClient, organizationId, (nodes) =>
          nodes.map((node) => {
            if (node.slug === args.agentSlug) return node;
            const has = node.directReports.includes(args.agentSlug);
            const should = desired.has(node.slug);
            if (has === should) return node;
            const directReports = should
              ? dedupeSorted([...node.directReports, args.agentSlug])
              : node.directReports.filter((slug) => slug !== args.agentSlug);
            return { ...node, directReports };
          }),
        ),
      };
    },
    onError: (_error, _args, context) => {
      if (context?.previous) {
        queryClient.setQueryData(orgChartKey(organizationId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: orgChartKey(organizationId),
      });
    },
  });
}
