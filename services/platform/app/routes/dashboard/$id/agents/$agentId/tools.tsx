import { PageSection } from '@tale/ui/page-section';
import { SectionHeader } from '@tale/ui/section-header';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { ToolSelector } from '@/app/features/agents/components/tool-selector';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useT } from '@/lib/i18n/client';
import { isRetrievalMode } from '@/lib/shared/schemas/agents';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/tools')({
  head: () => ({
    meta: seo('agentTools'),
  }),
  component: ToolsTab,
});

function ToolsTab() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();

  // Only chat agents run the platform tool loop. External agents keep just
  // their integration bindings (the sandbox MCP grant set); the platform-tool,
  // workflow, and web-search controls are no-ops for them, so hide them.
  const isChat = (config.primaryBehavior ?? 'chat') === 'chat';

  const webSearchMode =
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
        label: `${t('agents.tools.modeOff')} — ${t('agents.tools.webModeOffDescription')}`,
      },
      {
        value: 'tool',
        label: `${t('agents.tools.modeTool')} — ${t('agents.tools.webModeToolDescription')}`,
      },
      {
        value: 'context',
        label: `${t('agents.tools.modeContext')} — ${t('agents.tools.webModeContextDescription')}`,
      },
      {
        value: 'both',
        label: `${t('agents.tools.modeBoth')} — ${t('agents.tools.webModeBothDescription')}`,
      },
    ],
    [t],
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader
        title={t('agents.form.sectionTools')}
        description={
          isChat
            ? t('agents.form.sectionToolsDescription')
            : t('agents.form.sectionToolsExternalDescription')
        }
      />

      {isChat && (
        <PageSection
          gap={3}
          title={t('agents.tools.webSearchMode')}
          description={
            <>
              {t('agents.tools.webSearchModeDescription')}
              {'. '}
              {t('agents.tools.webSearchHint')}{' '}
              <Link
                to="/dashboard/$id/websites"
                params={{ id: organizationId }}
                className="text-primary hover:underline"
              >
                {t('agents.tools.webSearchHintLink')}
              </Link>
            </>
          }
        >
          <RadioGroup
            value={webSearchMode}
            onValueChange={(value) => {
              if (isRetrievalMode(value)) {
                updateConfig({ webSearchMode: value });
              }
            }}
            options={webModeOptions}
          />
        </PageSection>
      )}

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
        showPlatformTools={isChat}
        showWorkflows={isChat}
      />
    </ContentArea>
  );
}
