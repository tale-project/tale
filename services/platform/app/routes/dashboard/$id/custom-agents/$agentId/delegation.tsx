import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { NarrowContainer, Stack } from '@/app/components/ui/layout/layout';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useCustomAgents } from '@/app/features/custom-agents/hooks/queries';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { toast } from '@/app/hooks/use-toast';
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
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

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

  const selectedSet = useMemo(
    () => new Set(agent.delegateAgentIds?.map(String) ?? []),
    [agent.delegateAgentIds],
  );

  const saveWithStatus = useCallback(
    async <T,>(updateFn: () => Promise<T>) => {
      setSaveStatus('saving');
      try {
        await updateFn();
        setSaveStatus('saved');
      } catch (error) {
        console.error(error);
        setSaveStatus('error');
        toast({
          title: t('customAgents.agentUpdateFailed'),
          variant: 'destructive',
        });
      }
    },
    [t],
  );

  const toggleAgent = useCallback(
    async (targetRootId: string) => {
      if (isReadOnly) return;

      const current = agent.delegateAgentIds?.map(String) ?? [];
      const next = selectedSet.has(targetRootId)
        ? current.filter((id) => id !== targetRootId)
        : [...current, targetRootId];

      await saveWithStatus(() =>
        updateAgent.mutateAsync({
          customAgentId: toId<'customAgents'>(agentId),
          delegateAgentIds: next.map((id) => toId<'customAgents'>(id)),
        }),
      );
    },
    [
      agentId,
      agent.delegateAgentIds,
      selectedSet,
      updateAgent,
      saveWithStatus,
      isReadOnly,
    ],
  );

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <StickySectionHeader
          title={t('customAgents.delegation.title')}
          description={t('customAgents.delegation.description')}
          action={<AutoSaveIndicator status={saveStatus} />}
        />

        <fieldset disabled={isReadOnly}>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : availableAgents.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              {t('customAgents.delegation.noDelegatesAvailable')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {availableAgents.map((a) => {
                const rootId = String(a.rootVersionId ?? a._id);
                return (
                  <div key={rootId} className="flex items-center gap-2">
                    <Checkbox
                      label={a.displayName}
                      checked={selectedSet.has(rootId)}
                      onCheckedChange={() => toggleAgent(rootId)}
                    />
                    {a.description && (
                      <span className="text-muted-foreground truncate text-xs">
                        {a.description}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>
      </Stack>
    </NarrowContainer>
  );
}
