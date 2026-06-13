import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { OrgChartPayload } from '@/convex/agents/org_chart_actions';

const orgChartKey = (organizationId: string) =>
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
