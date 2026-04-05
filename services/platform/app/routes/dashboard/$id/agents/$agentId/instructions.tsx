import { createFileRoute } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
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
  const { providers } = useListProviders('default');
  const [addOpen, setAddOpen] = useState(false);

  const structuredResponsesEnabled = config.structuredResponsesEnabled ?? true;
  const selectedModels = config.supportedModels;

  const modelDisplayNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        map.set(model.id, model.displayName);
      }
    }
    return map;
  }, [providers]);

  const availableOptions = useMemo(() => {
    const allModels: { id: string; displayName: string }[] = [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      if (config.provider && provider.name !== config.provider) continue;
      for (const model of provider.models) {
        allModels.push({ id: model.id, displayName: model.displayName });
      }
    }
    const selected = new Set(selectedModels);
    return allModels
      .filter((m) => !selected.has(m.id))
      .map((m) => ({ value: m.id, label: m.displayName }));
  }, [providers, selectedModels, config.provider]);

  const getDisplayName = useCallback(
    (modelId: string) =>
      modelDisplayNames.get(modelId) ?? modelId.split('/').pop() ?? modelId,
    [modelDisplayNames],
  );

  const handleAddModel = useCallback(
    (modelId: string) => {
      updateConfig({ supportedModels: [...selectedModels, modelId] });
      setAddOpen(false);
    },
    [selectedModels, updateConfig],
  );

  const handleRemoveModel = useCallback(
    (modelId: string) => {
      if (selectedModels.length <= 1) return;
      updateConfig({
        supportedModels: selectedModels.filter((m) => m !== modelId),
      });
    },
    [selectedModels, updateConfig],
  );

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
        <div className="space-y-2">
          <ul className="space-y-1.5">
            {selectedModels.map((modelId) => (
              <li
                key={modelId}
                className="bg-muted flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm"
              >
                <code className="min-w-0 flex-1 truncate">
                  {getDisplayName(modelId)}
                </code>
                <button
                  type="button"
                  onClick={() => handleRemoveModel(modelId)}
                  disabled={selectedModels.length <= 1}
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 transition-colors disabled:pointer-events-none disabled:opacity-30"
                  aria-label={`${t('agents.form.removeModel')} ${getDisplayName(modelId)}`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <SearchableSelect
            value={null}
            onValueChange={handleAddModel}
            options={availableOptions}
            open={addOpen}
            onOpenChange={setAddOpen}
            searchPlaceholder={t('agents.form.searchModels')}
            emptyText={t('agents.form.noModelsFound')}
            aria-label={t('agents.form.addModel')}
            trigger={
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
              >
                <Plus className="size-3.5" />
                <span>{t('agents.form.addModel')}</span>
              </button>
            }
          />
        </div>
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
