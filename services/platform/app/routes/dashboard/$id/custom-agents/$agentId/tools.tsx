import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { ToolSelector } from '@/app/features/custom-agents/components/tool-selector';
import { useAgentConfig } from '@/app/features/custom-agents/hooks/use-agent-config-context';
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
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();

  const webSearchMode: RetrievalMode =
    config.webSearchMode ??
    (config.toolNames?.includes('web') ? 'tool' : 'off');

  const hiddenTools = useMemo(() => {
    const hidden = new Set<string>();
    hidden.add('rag_search');
    hidden.add('web');
    return hidden;
  }, []);

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
      />

      <PageSection
        gap={3}
        title={t('customAgents.tools.webSearchMode')}
        description={
          <>
            {t('customAgents.tools.webSearchModeDescription')}
            {'. '}
            {t('customAgents.tools.webSearchHint')}{' '}
            <Link
              to="/dashboard/$id/websites"
              params={{ id: organizationId }}
              className="text-primary hover:underline"
            >
              {t('customAgents.tools.webSearchHintLink')}
            </Link>
          </>
        }
      >
        <RadioGroup
          value={webSearchMode}
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RadioGroup returns string; options constrain to RetrievalMode values
          onValueChange={(value) =>
            updateConfig({ webSearchMode: value as RetrievalMode })
          }
          options={webModeOptions}
        />
      </PageSection>

      <ToolSelector
        value={config.toolNames ?? []}
        onChange={(toolNames) => updateConfig({ toolNames })}
        integrationBindings={config.integrationBindings ?? []}
        onIntegrationBindingsChange={(integrationBindings) =>
          updateConfig({ integrationBindings })
        }
        workflowBindings={config.workflows ?? []}
        onWorkflowBindingsChange={(workflows) => updateConfig({ workflows })}
        organizationId={organizationId}
        hiddenTools={hiddenTools}
      />
    </ContentArea>
  );
}
