import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback, useMemo, useEffect } from 'react';

import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { ToolSelector } from '@/app/features/custom-agents/components/tool-selector';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

type RetrievalMode = 'off' | 'tool' | 'context' | 'both';

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

  // Web search mode state
  const [webSearchMode, setWebSearchMode] = useState<RetrievalMode>('off');
  const [webModeInitialized, setWebModeInitialized] = useState(false);

  useEffect(() => {
    if (!agent) return;
    const mode: RetrievalMode =
      agent.webSearchMode ?? (agent.toolNames.includes('web') ? 'tool' : 'off');
    setWebSearchMode(mode);
    setWebModeInitialized(true);
  }, [agent, agentId]);

  // Tools hidden from the checkbox list (managed by mode selectors)
  const hiddenTools = useMemo(() => {
    const hidden = new Set<string>();
    hidden.add('rag_search');
    if (webSearchMode !== 'off') {
      hidden.add('web');
    }
    return hidden;
  }, [webSearchMode]);

  // Auto-save web search mode
  const webModeData = useMemo(() => ({ webSearchMode }), [webSearchMode]);

  const handleWebModeSave = useCallback(
    async (data: { webSearchMode?: RetrievalMode }) => {
      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        webSearchMode: data.webSearchMode,
      });
    },
    [agentId, updateAgent],
  );

  const { status: webModeStatus } = useAutoSave({
    data: webModeData,
    onSave: handleWebModeSave,
    enabled: webModeInitialized && !isReadOnly,
  });

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
      await saveWithStatus(() =>
        updateAgent.mutateAsync({
          customAgentId: toId<'customAgents'>(agentId),
          toolNames: tools,
        }),
      );
    },
    [agentId, updateAgent, saveWithStatus, isReadOnly],
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

  const webModeOptions = useMemo(
    () => [
      {
        value: 'off',
        label: `${t('customAgents.tools.modeOff')} — ${t('customAgents.tools.webModeOffDescription')}`,
      },
      {
        value: 'tool',
        label: `${t('customAgents.tools.modeTool')} — ${t('customAgents.tools.webModeToolDescription')}`,
      },
      {
        value: 'context',
        label: `${t('customAgents.tools.modeContext')} — ${t('customAgents.tools.webModeContextDescription')}`,
      },
      {
        value: 'both',
        label: `${t('customAgents.tools.modeBoth')} — ${t('customAgents.tools.webModeBothDescription')}`,
      },
    ],
    [t],
  );

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <StickySectionHeader
          title={t('customAgents.form.sectionTools')}
          description={t('customAgents.form.sectionToolsDescription')}
          action={<AutoSaveIndicator status={saveStatus} />}
        />

        <SectionHeader
          title={t('customAgents.tools.webSearchMode')}
          description={t('customAgents.tools.webSearchModeDescription')}
          action={<AutoSaveIndicator status={webModeStatus} />}
        />

        <RadioGroup
          value={webSearchMode}
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RadioGroup returns string; options constrain to RetrievalMode values
          onValueChange={(value) => setWebSearchMode(value as RetrievalMode)}
          options={webModeOptions}
          disabled={isReadOnly}
        />

        <ToolSelector
          value={agent.toolNames}
          onChange={handleToolChange}
          integrationBindings={agent.integrationBindings ?? []}
          onIntegrationBindingsChange={handleIntegrationBindingsChange}
          organizationId={organizationId}
          hiddenTools={hiddenTools}
          disabled={isReadOnly}
        />
      </Stack>
    </NarrowContainer>
  );
}
