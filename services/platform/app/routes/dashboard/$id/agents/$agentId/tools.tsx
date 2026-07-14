import { PageSection } from '@tale/ui/page-section';
import { Text } from '@tale/ui/text';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { AgentTabContent } from '@/app/features/agents/components/agent-tab-content';
import { ToolSelector } from '@/app/features/agents/components/tool-selector';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { TOOL_NAMES } from '@/convex/agent_tools/tool_names';
import { useT } from '@/lib/i18n/client';
import {
  EXTERNAL_AGENT_TOOL_NAMES,
  isRetrievalMode,
} from '@/lib/shared/schemas/agents';
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

  // Only chat agents run the platform tool loop. An external agent still
  // binds two grant sets here — integrations and the sandbox-bridgeable
  // platform tools (EXTERNAL_AGENT_TOOL_NAMES), both dispatched from its
  // container over the MCP bridge — while the workflow and web-search
  // controls stay chat-only no-ops.
  const isChat = (config.primaryBehavior ?? 'chat') === 'chat';
  const isExternal = config.primaryBehavior === 'external-agent';

  const webSearchMode =
    config.webSearchMode ??
    (config.toolNames?.includes('web') ? 'tool' : 'off');

  const hiddenTools = useMemo(() => {
    const hidden = new Set<string>();
    if (isExternal) {
      // The picker offers only the sandbox-bridgeable subset (the schema
      // rejects everything else for external agents anyway).
      const bridgeable: readonly string[] = EXTERNAL_AGENT_TOOL_NAMES;
      for (const name of TOOL_NAMES) {
        if (!bridgeable.includes(name)) hidden.add(name);
      }
      return hidden;
    }
    // Chat agents govern these two via the knowledge / web-search modes.
    hidden.add('rag_search');
    hidden.add('web');
    return hidden;
  }, [isExternal]);

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
    <AgentTabContent>
      {/* No tab-level heading — the tab strip already names the tab (the same
          no-page-title rule as settings pages); the description leads alone. */}
      <Text variant="muted" className="text-sm">
        {isChat
          ? t('agents.form.sectionToolsDescription')
          : t('agents.form.sectionToolsExternalDescription')}
      </Text>

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
        showPlatformTools={isChat || isExternal}
        showWorkflows={isChat}
      />
    </AgentTabContent>
  );
}
