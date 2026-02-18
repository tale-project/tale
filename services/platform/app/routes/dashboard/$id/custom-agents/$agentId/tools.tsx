import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback, useMemo } from 'react';

import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { ToolSelector } from '@/app/features/custom-agents/components/tool-selector';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';
import { toId } from '@/lib/utils/type-guards';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/tools',
)({
  head: () => ({
    meta: seo('agentTools'),
  }),
  component: ToolsTab,
});

function ToolsTab() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateAgent = useUpdateCustomAgent();
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  const lockedTools = useMemo(() => {
    const locked = new Set<string>();
    if (agent.knowledgeEnabled) {
      locked.add('rag_search');
    }
    return locked;
  }, [agent.knowledgeEnabled]);

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

  const handleToolChange = useCallback(
    async (tools: string[]) => {
      if (isReadOnly) return;
      const finalTools =
        agent.knowledgeEnabled && !tools.includes('rag_search')
          ? [...tools, 'rag_search']
          : tools;
      await saveWithStatus(() =>
        updateAgent.mutateAsync({
          customAgentId: toId<'customAgents'>(agentId),
          toolNames: finalTools,
        }),
      );
    },
    [agentId, updateAgent, agent.knowledgeEnabled, saveWithStatus, isReadOnly],
  );

  const handleIntegrationBindingsChange = useCallback(
    async (bindings: string[]) => {
      if (isReadOnly) return;
      await saveWithStatus(() =>
        updateAgent.mutateAsync({
          customAgentId: toId<'customAgents'>(agentId),
          integrationBindings: bindings,
        }),
      );
    },
    [agentId, updateAgent, saveWithStatus, isReadOnly],
  );

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <StickySectionHeader
          title={t('customAgents.form.sectionTools')}
          description={t('customAgents.form.sectionToolsDescription')}
          action={<AutoSaveIndicator status={saveStatus} />}
        />

        <ToolSelector
          value={agent.toolNames}
          onChange={handleToolChange}
          integrationBindings={agent.integrationBindings ?? []}
          onIntegrationBindingsChange={handleIntegrationBindingsChange}
          organizationId={organizationId}
          lockedTools={lockedTools}
          disabled={isReadOnly}
        />
      </Stack>
    </NarrowContainer>
  );
}
