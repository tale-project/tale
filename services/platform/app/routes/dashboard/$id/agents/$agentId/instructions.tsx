import { createFileRoute } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { ModelSelector } from '@/app/components/ui/forms/model-selector';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { SUPPORTED_TEMPLATE_VARIABLES } from '@/convex/lib/agent_response/resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from '@/convex/lib/agent_response/structured_response_instructions';
import { useT } from '@/lib/i18n/client';
import {
  parseModelRef,
  stripModelRefQualifier,
} from '@/lib/shared/utils/model-ref';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const PromptLibraryDialog = lazyComponent<
  import('@/app/features/prompts/components/prompt-library-dialog').PromptLibraryDialogProps
>(() =>
  import('@/app/features/prompts/components/prompt-library-dialog').then(
    (m) => ({ default: m.PromptLibraryDialog }),
  ),
);

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
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);

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

  const modelTagsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        map.set(model.id, model.tags ?? []);
      }
    }
    return map;
  }, [providers]);

  // For unqualified refs, record every provider that defines each model id so
  // we can resolve (and hint about ambiguity) on display.
  const modelProvidersMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        const list = map.get(model.id);
        if (list) list.push(provider.name);
        else map.set(model.id, [provider.name]);
      }
    }
    return map;
  }, [providers]);

  const availableOptions = useMemo(() => {
    const allModels: {
      id: string;
      displayName: string;
      providerName: string;
    }[] = [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      if (config.provider && provider.name !== config.provider) continue;
      for (const model of provider.models) {
        allModels.push({
          id: model.id,
          displayName: model.displayName,
          providerName: provider.name,
        });
      }
    }
    const selected = new Set(selectedModels.map(stripModelRefQualifier));
    return allModels
      .filter((m) => !selected.has(m.id))
      .map((m) => {
        const tags = modelTagsMap.get(m.id) ?? [];
        const isEmbeddingOnly =
          tags.includes('embedding') && !tags.includes('chat');
        const viaProvider = t('agents.form.viaProvider', {
          provider: m.providerName,
          defaultValue: `via ${m.providerName}`,
        });
        const description = isEmbeddingOnly
          ? `${viaProvider} — ${t('agents.form.embeddingModelWarning')}`
          : viaProvider;
        return {
          // Save in qualified form so routing is explicit even if multiple
          // providers later define the same model id.
          value: `${m.providerName}:${m.id}`,
          label: m.displayName,
          description,
        };
      });
  }, [providers, selectedModels, config.provider, modelTagsMap, t]);

  const getDisplayName = useCallback(
    (ref: string) => {
      const plain = stripModelRefQualifier(ref);
      return modelDisplayNames.get(plain) ?? plain.split('/').pop() ?? plain;
    },
    [modelDisplayNames],
  );

  const getProviderName = useCallback(
    (ref: string): string | undefined => {
      const { providerName, modelId } = parseModelRef(ref);
      if (providerName) return providerName;
      const matches = modelProvidersMap.get(modelId);
      if (!matches || matches.length === 0) return undefined;
      if (matches.length === 1) return matches[0];
      // Unqualified but resolvable from multiple providers — surface ambiguity.
      return `${matches[0]} (+${matches.length - 1})`;
    },
    [modelProvidersMap],
  );

  const handleModelsChange = useCallback(
    (models: string[]) => {
      updateConfig({ supportedModels: models });
    },
    [updateConfig],
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <PageSection
        title={t('agents.form.sectionInstructions')}
        description={t('agents.form.sectionInstructionsDescription')}
        gap={4}
      >
        <div className="flex flex-col gap-2">
          <HStack justify="between" align="center">
            <label htmlFor="systemInstructions" className="text-sm font-medium">
              {t('agents.form.systemInstructions')}
            </label>
            <Tooltip content={t('agents.form.browsePrompts')} side="top">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPromptLibraryOpen(true)}
                aria-label={t('agents.form.browsePrompts')}
              >
                <BookOpen className="mr-1 size-4" />
                {t('agents.form.browsePrompts')}
              </Button>
            </Tooltip>
          </HStack>
          <Textarea
            id="systemInstructions"
            placeholder={t('agents.form.systemInstructionsPlaceholder')}
            value={config.systemInstructions}
            onChange={(e) =>
              updateConfig({ systemInstructions: e.target.value })
            }
            required
            rows={8}
            className="font-mono text-sm"
          />
        </div>
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
        <ModelSelector
          models={selectedModels}
          onChange={handleModelsChange}
          availableOptions={availableOptions}
          getDisplayName={getDisplayName}
          getProviderName={getProviderName}
        />
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

      <PromptLibraryDialog
        open={promptLibraryOpen}
        onOpenChange={setPromptLibraryOpen}
        onSelectPrompt={(content) => {
          const current = config.systemInstructions;
          const separator = current.trim() ? '\n\n' : '';
          updateConfig({
            systemInstructions: current + separator + content,
          });
        }}
      />
    </ContentArea>
  );
}
