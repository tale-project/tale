import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback, useMemo, useEffect } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { ToolSelector } from '@/app/features/custom-agents/components/tool-selector';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
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

  const [webSearchMode, setWebSearchMode] = useState<RetrievalMode>('off');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedBindings, setSelectedBindings] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!agent) return;
    const mode: RetrievalMode =
      agent.webSearchMode ?? (agent.toolNames.includes('web') ? 'tool' : 'off');
    setWebSearchMode(mode);
    setSelectedTools(agent.toolNames);
    setSelectedBindings(agent.integrationBindings ?? []);
    setInitialized(true);
  }, [agent, agentId]);

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
    enabled: initialized && !isReadOnly,
  });

  // Auto-save tools and integration bindings
  const toolsData = useMemo(
    () => ({ toolNames: selectedTools, integrationBindings: selectedBindings }),
    [selectedTools, selectedBindings],
  );

  const handleToolsSave = useCallback(
    async (data: { toolNames: string[]; integrationBindings: string[] }) => {
      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        toolNames: data.toolNames,
        integrationBindings: data.integrationBindings,
      });
    },
    [agentId, updateAgent],
  );

  const { status: toolsStatus } = useAutoSave({
    data: toolsData,
    onSave: handleToolsSave,
    enabled: initialized && !isReadOnly,
  });

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
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('customAgents.form.sectionTools')}
        description={t('customAgents.form.sectionToolsDescription')}
        action={<AutoSaveIndicator status={toolsStatus} />}
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
        value={selectedTools}
        onChange={setSelectedTools}
        integrationBindings={selectedBindings}
        onIntegrationBindingsChange={setSelectedBindings}
        organizationId={organizationId}
        hiddenTools={hiddenTools}
        disabled={isReadOnly}
      />
    </ContentArea>
  );
}
