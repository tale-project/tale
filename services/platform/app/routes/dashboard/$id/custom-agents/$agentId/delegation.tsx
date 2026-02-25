import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { Stack } from '@/app/components/ui/layout/layout';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { Text } from '@/app/components/ui/typography/text';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useCustomAgents } from '@/app/features/custom-agents/hooks/queries';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/delegation',
)({
  head: () => ({
    meta: seo('agentDelegation'),
  }),
  component: DelegationTab,
});

function DelegationTab() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateAgent = useUpdateCustomAgent();
  const { agents, isLoading } = useCustomAgents(organizationId);

  const currentRootId = agent.rootVersionId ?? agent._id;

  const availableAgents = useMemo(() => {
    if (!agents) return [];
    return agents
      .filter((a) => {
        if (a.status !== 'active') return false;
        const rootId = a.rootVersionId ?? a._id;
        return rootId !== currentRootId;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [agents, currentRootId]);

  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!agent) return;
    setSelectedValues(agent.delegateAgentIds?.map(String) ?? []);
    setInitialized(true);
  }, [agent, agentId]);

  const delegateOptions = useMemo(
    () =>
      availableAgents.map((a) => ({
        value: String(a.rootVersionId ?? a._id),
        label: a.displayName,
        description: a.description,
      })),
    [availableAgents],
  );

  const delegateData = useMemo(
    () => ({ delegateAgentIds: selectedValues }),
    [selectedValues],
  );

  const handleSave = useCallback(
    async (data: { delegateAgentIds: string[] }) => {
      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        delegateAgentIds: data.delegateAgentIds.map((id) =>
          toId<'customAgents'>(id),
        ),
      });
    },
    [agentId, updateAgent],
  );

  const { status } = useAutoSave({
    data: delegateData,
    onSave: handleSave,
    enabled: initialized && !isReadOnly,
  });

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('customAgents.delegation.title')}
        description={t('customAgents.delegation.description')}
        action={<AutoSaveIndicator status={status} />}
      />

      {isLoading ? (
        <Stack gap={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </Stack>
      ) : availableAgents.length === 0 ? (
        <Text variant="muted" className="italic">
          {t('customAgents.delegation.noDelegatesAvailable')}
        </Text>
      ) : (
        <CheckboxGroup
          options={delegateOptions}
          value={selectedValues}
          onValueChange={setSelectedValues}
          disabled={isReadOnly}
          columns={1}
        />
      )}
    </ContentArea>
  );
}
