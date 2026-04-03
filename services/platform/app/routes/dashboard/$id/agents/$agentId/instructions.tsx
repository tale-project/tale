import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { SUPPORTED_TEMPLATE_VARIABLES } from '@/convex/lib/agent_response/resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from '@/convex/lib/agent_response/structured_response_instructions';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/instructions',
)({
  head: () => ({
    meta: seo('agentInstructions'),
  }),
  component: InstructionsTab,
});

function InstructionsTab() {
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();

  const structuredResponsesEnabled = config.structuredResponsesEnabled ?? true;

  return (
    <ContentArea variant="narrow" gap={6}>
      <PageSection
        title={t('agents.form.sectionInstructions')}
        description={t('agents.form.sectionInstructionsDescription')}
        gap={4}
      >
        <Textarea
          id="systemInstructions"
          label={t('agents.form.systemInstructions')}
          placeholder={t('agents.form.systemInstructionsPlaceholder')}
          value={config.systemInstructions}
          onChange={(e) => updateConfig({ systemInstructions: e.target.value })}
          required
          rows={8}
          className="font-mono text-sm"
        />
        <CollapsibleDetails
          variant="compact"
          summary={t('agents.form.templateVariablesLabel')}
        >
          <p className="text-muted-foreground mt-1 mb-2 text-xs">
            {t('agents.form.templateVariablesDescription')}
          </p>
          <ul className="text-muted-foreground space-y-0.5 font-mono text-xs">
            {SUPPORTED_TEMPLATE_VARIABLES.map((v) => (
              <li key={v.variable}>
                <code className="bg-muted rounded px-1">{v.variable}</code>{' '}
                <span className="font-sans">&mdash; {v.description}</span>
              </li>
            ))}
          </ul>
        </CollapsibleDetails>
      </PageSection>

      <PageSection
        title={t('agents.form.sectionModel')}
        description={t('agents.form.sectionModelDescription')}
      >
        <ul className="space-y-1 text-sm">
          {(config.supportedModels ?? []).map((model) => (
            <li key={model}>
              <code className="bg-muted rounded px-1.5 py-0.5">{model}</code>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection
        title={t('agents.form.sectionStructuredResponses')}
        description={t('agents.form.sectionStructuredResponsesDescription')}
      >
        <Switch
          checked={structuredResponsesEnabled}
          onCheckedChange={(checked) =>
            updateConfig({ structuredResponsesEnabled: checked })
          }
          label={t('agents.form.structuredResponsesEnabled')}
          description={t('agents.form.structuredResponsesEnabledHelp')}
        />
        {structuredResponsesEnabled && (
          <CodeBlock
            label={t('agents.form.structuredResponsesInjectedPrompt')}
            copyValue={STRUCTURED_RESPONSE_INSTRUCTIONS}
            copyLabel={t('agents.form.copyPrompt')}
          >
            {STRUCTURED_RESPONSE_INSTRUCTIONS}
          </CodeBlock>
        )}
      </PageSection>
    </ContentArea>
  );
}
