import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useState, useCallback, useMemo } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { ToolSelector } from '@/app/features/custom-agents/components/tool-selector';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/use-custom-agent-mutations';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/tools',
)({
  component: ToolsTab,
});

function ToolsTab() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const updateAgent = useUpdateCustomAgent();
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  const agent = useQuery(api.custom_agents.queries.getCustomAgent, {
    customAgentId: toId<'customAgents'>(agentId),
  });

  const lockedTools = useMemo(() => {
    const locked = new Set<string>();
    if (agent?.knowledgeEnabled) {
      locked.add('rag_search');
    }
    return locked;
  }, [agent?.knowledgeEnabled]);

  const handleToolChange = useCallback(
    async (tools: string[]) => {
      const finalTools =
        agent?.knowledgeEnabled && !tools.includes('rag_search')
          ? [...tools, 'rag_search']
          : tools;
      setSaveStatus('saving');
      try {
        await updateAgent({
          customAgentId: toId<'customAgents'>(agentId),
          toolNames: finalTools,
        });
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
    [agentId, updateAgent, t, agent?.knowledgeEnabled],
  );

  const handleIntegrationBindingsChange = useCallback(
    async (bindings: string[]) => {
      setSaveStatus('saving');
      try {
        await updateAgent({
          customAgentId: toId<'customAgents'>(agentId),
          integrationBindings: bindings,
        });
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
    [agentId, updateAgent, t],
  );

  if (!agent) {
    return (
      <NarrowContainer className="py-4">
        <Stack gap={4}>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-64 w-full" />
        </Stack>
      </NarrowContainer>
    );
  }

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <div className="bg-background sticky top-[49px] z-40 -mx-4 flex items-center justify-between px-4 md:top-[97px]">
          <Stack gap={1}>
            <h2 className="text-foreground text-base font-semibold">
              {t('customAgents.form.sectionTools')}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t('customAgents.form.sectionToolsDescription')}
            </p>
          </Stack>
          <AutoSaveIndicator status={saveStatus} />
        </div>

        <ToolSelector
          value={agent.toolNames}
          onChange={handleToolChange}
          integrationBindings={agent.integrationBindings ?? []}
          onIntegrationBindingsChange={handleIntegrationBindingsChange}
          organizationId={organizationId}
          lockedTools={lockedTools}
        />
      </Stack>
    </NarrowContainer>
  );
}
