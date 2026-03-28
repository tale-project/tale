import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { Stack } from '@/app/components/ui/layout/layout';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { Text } from '@/app/components/ui/typography/text';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/delegation',
)({
  head: () => ({
    meta: seo('agentDelegation'),
  }),
  component: DelegationTab,
});

interface AgentListEntry {
  name: string;
  displayName?: string;
  description?: string;
}

function DelegationTab() {
  const { t } = useT('settings');
  const { config, updateConfig, agentName } = useAgentConfig();

  const listAgentsAction = useConvexAction(api.agents.file_actions.listAgents);
  const listAgentsRef = useRef(listAgentsAction);
  listAgentsRef.current = listAgentsAction;

  const [availableAgents, setAvailableAgents] = useState<AgentListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns AgentListEntry[] but typed as any
        const agents = (await listAgentsRef.current.mutateAsync({
          orgSlug: 'default',
        })) as AgentListEntry[];
        if (!cancelled) {
          setAvailableAgents(
            agents.filter(
              (a) => a.name !== agentName && a.displayName !== undefined,
            ),
          );
        }
      } catch {
        // Silently handle — empty list shown
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);

  const delegateOptions = useMemo(
    () =>
      availableAgents.map((a) => ({
        value: a.name,
        label: a.displayName ?? a.name,
        description: a.description,
      })),
    [availableAgents],
  );

  const selectedValues = config.delegates ?? [];

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.delegation.title')}
        description={t('agents.delegation.description')}
      />

      {isLoading ? (
        <Stack gap={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </Stack>
      ) : availableAgents.length === 0 ? (
        <Text variant="muted" className="italic">
          {t('agents.delegation.noDelegatesAvailable')}
        </Text>
      ) : (
        <CheckboxGroup
          options={delegateOptions}
          value={selectedValues}
          onValueChange={(delegates) => updateConfig({ delegates })}
          columns={1}
        />
      )}
    </ContentArea>
  );
}
