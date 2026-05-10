import { Button } from '@tale/ui/button';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { ModelSelector } from '@/app/components/ui/forms/model-selector';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { LocaleTabs } from '@/app/components/ui/i18n/locale-tabs';
import { HStack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useTranslateAgentFields } from '@/app/features/agents/hooks/mutations';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { SUPPORTED_TEMPLATE_VARIABLES } from '@/convex/lib/agent_response/resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from '@/convex/lib/agent_response/structured_response_instructions';
import { useT } from '@/lib/i18n/client';
import { getVariantBadgeLabel } from '@/lib/shared/utils/expand-model-variants';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';
import {
  formatModelRef,
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
  const { id: organizationId } = Route.useParams();
  const { config, updateConfig } = useAgentConfig();
  const { providers } = useListProviders('default');
  const { data: organization } = useOrganization(organizationId);
  const translateMutation = useTranslateAgentFields();
  const { toast } = useToast();
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);

  const defaultLocale = getOrganizationDefaultLocale(organization?.metadata);
  const [editingLocale, setEditingLocale] = useState(defaultLocale);

  const legacyInstructions = config.systemInstructions ?? '';
  const overrideForLocale = (locale: string): string | undefined =>
    config.i18n?.[locale]?.systemInstructions;

  // Edit buffer — the textarea's current value. Reads from i18n[locale] for
  // the active tab; for the default-locale tab, falls through to the legacy
  // top-level field when no i18n.<default> entry exists yet (so older agents
  // still show their authored text on first open). Uses `??` so an
  // intentionally-cleared i18n entry (undefined) falls back but a non-default
  // locale with no entry stays empty, encouraging translation.
  const currentValue =
    overrideForLocale(editingLocale) ??
    (editingLocale === defaultLocale ? legacyInstructions : '');

  const hasTranslation = useCallback(
    (locale: string): boolean =>
      !!config.i18n?.[locale]?.systemInstructions ||
      (locale === defaultLocale && !!legacyInstructions),
    [config.i18n, defaultLocale, legacyInstructions],
  );

  // Write path: always writes to i18n.<locale>. Empty value clears the key
  // (never persists ""). Server-side `normalizeAgentConfig` retires the
  // top-level `systemInstructions` at the write boundary when
  // `i18n[defaultLocale].systemInstructions` carries content.
  const writeOverride = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const existingI18n = config.i18n ?? {};
      const existingOverrides = existingI18n[editingLocale] ?? {};
      updateConfig({
        i18n: {
          ...existingI18n,
          [editingLocale]: {
            ...existingOverrides,
            systemInstructions: trimmed ? value : undefined,
          },
        },
      });
    },
    [config.i18n, editingLocale, updateConfig],
  );

  const sourceForTranslation =
    overrideForLocale(defaultLocale) ?? legacyInstructions;

  const handleAutoTranslate = useCallback(async () => {
    if (editingLocale === defaultLocale || !sourceForTranslation) return;
    const target = editingLocale;
    try {
      const result = await translateMutation.mutateAsync({
        fields: { systemInstructions: sourceForTranslation },
        targetLocale: target,
      });
      if (
        result.error ||
        typeof result.translated.systemInstructions !== 'string'
      ) {
        toast({
          title: t('agents.conversationStarters.translateError'),
          variant: 'destructive',
        });
        return;
      }
      if (editingLocale !== target) return;
      const translated = result.translated.systemInstructions;
      const existingI18n = config.i18n ?? {};
      const existingOverrides = existingI18n[target] ?? {};
      updateConfig({
        i18n: {
          ...existingI18n,
          [target]: {
            ...existingOverrides,
            systemInstructions: translated,
          },
        },
      });
    } catch (error) {
      console.error('[auto-translate]', error);
      toast({
        title: t('agents.conversationStarters.translateError'),
        variant: 'destructive',
      });
    }
  }, [
    editingLocale,
    defaultLocale,
    sourceForTranslation,
    translateMutation,
    toast,
    t,
    config.i18n,
    updateConfig,
  ]);

  const structuredResponsesEnabled = config.structuredResponsesEnabled ?? false;
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
    // Each entry is a *concrete* selectable ref — for models with a
    // `quantizations` array, that's one entry per declared variant. The base
    // (unsplit) entry is intentionally dropped so users always pick a
    // specific weight format, matching the chat selector's behavior.
    const candidates: {
      ref: string;
      displayName: string;
      providerName: string;
      tags: string[];
      quantization?: string;
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
        const variants = Array.isArray(model.quantizations)
          ? model.quantizations
          : undefined;
        if (variants && variants.length > 0) {
          for (const q of variants) {
            candidates.push({
              ref: formatModelRef({
                providerName: provider.name,
                modelId: model.id,
                quantization: q,
              }),
              displayName: model.displayName,
              providerName: provider.name,
              tags: model.tags ?? [],
              quantization: q,
            });
          }
        } else {
          candidates.push({
            ref: formatModelRef({
              providerName: provider.name,
              modelId: model.id,
            }),
            displayName: model.displayName,
            providerName: provider.name,
            tags: model.tags ?? [],
          });
        }
      }
    }
    // Dedup against already-selected refs at the variant level so the user
    // can add multiple variants of the same base model. Match both qualified
    // and unqualified saved forms.
    const selectedRefs = new Set(selectedModels);
    const selectedBareIds = new Set(selectedModels.map(stripModelRefQualifier));
    return candidates
      .filter(
        (c) =>
          !selectedRefs.has(c.ref) &&
          // also rule out a candidate whose unqualified form was saved
          !selectedRefs.has(
            c.quantization
              ? `${stripModelRefQualifier(c.ref)}@${c.quantization}`
              : stripModelRefQualifier(c.ref),
          ) &&
          // and don't suggest a model already saved without provider prefix
          !(
            !c.quantization &&
            selectedBareIds.has(stripModelRefQualifier(c.ref))
          ),
      )
      .map((c) => {
        const isEmbeddingOnly =
          c.tags.includes('embedding') && !c.tags.includes('chat');
        const viaProvider = t('agents.form.viaProvider', {
          provider: c.providerName,
          defaultValue: `via ${c.providerName}`,
        });
        const variantSuffix = c.quantization
          ? ` — ${getVariantBadgeLabel(c.quantization)}`
          : '';
        const description = isEmbeddingOnly
          ? `${viaProvider}${variantSuffix} — ${t('agents.form.embeddingModelWarning')}`
          : `${viaProvider}${variantSuffix}`;
        return {
          // Save in qualified form so routing is explicit even if multiple
          // providers later define the same model id; quantization variant
          // is encoded as `@<quant>` per parseModelRef.
          value: c.ref,
          label: c.displayName,
          description,
        };
      });
  }, [providers, selectedModels, config.provider, t]);

  const getDisplayName = useCallback(
    (ref: string) => {
      const { modelId, quantization } = parseModelRef(ref);
      const base =
        modelDisplayNames.get(modelId) ?? modelId.split('/').pop() ?? modelId;
      return quantization
        ? `${base} (${getVariantBadgeLabel(quantization)})`
        : base;
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
        <div className="flex flex-col gap-3">
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
          <LocaleTabs
            defaultLocale={defaultLocale}
            editingLocale={editingLocale}
            onEditingLocaleChange={setEditingLocale}
            hasTranslation={hasTranslation}
            onAutoTranslate={
              sourceForTranslation ? handleAutoTranslate : undefined
            }
            isTranslating={translateMutation.isPending}
            subtitle={
              currentValue
                ? t('agents.form.systemInstructionsCharCount', {
                    count: currentValue.length,
                    defaultValue: `${currentValue.length} characters`,
                  })
                : undefined
            }
          />
          <Textarea
            id="systemInstructions"
            placeholder={t('agents.form.systemInstructionsPlaceholder')}
            value={currentValue}
            onChange={(e) => writeOverride(e.target.value)}
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
          const separator = currentValue.trim() ? '\n\n' : '';
          writeOverride(currentValue + separator + content);
        }}
      />
    </ContentArea>
  );
}
