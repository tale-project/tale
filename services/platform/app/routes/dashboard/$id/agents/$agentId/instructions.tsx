import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Text } from '@tale/ui/text';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, Info } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ModelSelector } from '@/app/components/ui/forms/model-selector';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { LocaleTabs } from '@/app/components/ui/i18n/locale-tabs';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { AgentTabContent } from '@/app/features/agents/components/agent-tab-content';
import { ByoModelEditor } from '@/app/features/agents/components/byo-model-editor';
import { useTranslateAgentFields } from '@/app/features/agents/hooks/mutations';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useAgentValidation } from '@/app/features/agents/hooks/use-agent-validation';
import { ModelInfoPopover } from '@/app/features/chat/components/model-info-popover';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import {
  useListProviders,
  useModelCapabilities,
} from '@/app/features/settings/providers/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { SUPPORTED_TEMPLATE_VARIABLES } from '@/convex/lib/agent_response/resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from '@/convex/lib/agent_response/structured_response_instructions';
import { getCredentialPolicy } from '@/lib/agent-adapters/credential-policy';
import type { ProductAgentSlug } from '@/lib/agent-adapters/events';
import { resolveProductAgentKind } from '@/lib/agent-adapters/events';
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

/** Sentinel for the vision-model picker's "use org default" choice — selecting
 * it clears `visionModel` (undefined) so the runtime resolves the provider
 * registry's `vision`-tagged default. Non-empty so it never collides with the
 * spurious empty-string Radix emits on close. */
const VISION_MODEL_AUTO = '__auto__';

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
  // Inline errors for the required fields this tab owns: system instructions
  // (any locale counts) and the ≥1-model floor, mirroring the save schema so
  // the disabled Save button always has a visible reason here (#2665).
  const { fieldErrors } = useAgentValidation(config);
  const { providers } = useListProviders(organizationId);
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
        organizationId,
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
    organizationId,
    toast,
    t,
    config.i18n,
    updateConfig,
  ]);

  const structuredResponsesEnabled = config.structuredResponsesEnabled ?? false;
  // A BYO agent may carry no models (optional raw passthrough), so guard the
  // (typed-as-required) field against an undefined runtime value. Memoized so
  // the fallback keeps a stable identity across renders (used in hook deps).
  const selectedModels = useMemo(
    () => config.supportedModels ?? [],
    [config.supportedModels],
  );

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

  // Capability tags per bare model id, for the info popover's "Type" row.
  const modelTagsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) map.set(model.id, model.tags ?? []);
    }
    return map;
  }, [providers]);

  // Cached catalog capabilities keyed by bare model id, for the info popover.
  const capabilities = useModelCapabilities(
    organizationId,
    useMemo(() => [...modelTagsMap.keys()], [modelTagsMap]),
  );

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
        // Models flagged "Hidden from model pickers" must not appear in the
        // agent's Add-model picker — the flag's contract covers agent model
        // selection too (see providers schema), matching the chat composer
        // (model-selector.tsx) and the create-agent dialog. Already-selected
        // models are dropped as candidates below, so a hidden model an agent
        // already references stays in its saved list without being re-offered.
        if (model.hidden === true) continue;
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

  // Catalog membership for saved refs. Hidden models still count (resolvable
  // at runtime); only a missing id is a problem. Matches create-dialog's
  // validRefs check so an orphan pack/UI save cannot look like a catalog pick.
  const getModelWarning = useCallback(
    (ref: string): string | undefined => {
      const { providerName, modelId } = parseModelRef(ref);
      const inProvider = (name: string): boolean => {
        const provider = providers.find((p) => p?.name === name);
        if (!provider || !Array.isArray(provider.models)) return false;
        return provider.models.some((m) => m.id === modelId);
      };
      if (providerName) {
        if (inProvider(providerName)) return undefined;
        return t('agents.form.modelNotInCatalog', { provider: providerName });
      }
      if (modelProvidersMap.has(modelId)) return undefined;
      return t('agents.form.modelNotInAnyCatalog');
    },
    [providers, modelProvidersMap, t],
  );

  // Vision-model picker options for the managed text-only image polyfill. The
  // first entry ('auto') clears `visionModel` so the runtime falls back to the
  // provider registry's `vision`-tagged default; the rest are every concrete
  // `vision`-tagged ref (one per quantization variant), saved qualified.
  const visionModelOptions = useMemo<SearchableSelectOption[]>(() => {
    const opts: SearchableSelectOption[] = [
      {
        value: VISION_MODEL_AUTO,
        label: t('agents.form.vision.autoLabel'),
        description: t('agents.form.vision.autoDescription'),
      },
    ];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        if (!(model.tags ?? []).includes('vision')) continue;
        const variants = Array.isArray(model.quantizations)
          ? model.quantizations
          : [undefined];
        for (const quantization of variants) {
          opts.push({
            value: formatModelRef({
              providerName: provider.name,
              modelId: model.id,
              ...(quantization !== undefined && { quantization }),
            }),
            label: quantization
              ? `${model.displayName} (${getVariantBadgeLabel(quantization)})`
              : model.displayName,
            description: t('agents.form.viaProvider', {
              provider: provider.name,
            }),
          });
        }
      }
    }
    return opts;
  }, [providers, t]);

  const renderItemAction = useCallback(
    (ref: string) => {
      const { modelId } = parseModelRef(ref);
      return (
        <ModelInfoPopover
          providerName={getProviderName(ref)}
          tags={modelTagsMap.get(modelId) ?? []}
          capabilities={capabilities.get(modelId)}
          organizationId={organizationId}
        />
      );
    },
    [modelTagsMap, capabilities, organizationId, getProviderName],
  );

  const handleModelsChange = useCallback(
    (models: string[]) => {
      updateConfig({ supportedModels: models });
    },
    [updateConfig],
  );

  // authMode only applies to external-agent agents (gate the whole control on
  // it). 'managed' (default) routes through the platform gateway; 'byo'
  // bypasses it and uses the user's own sandbox credentials with a raw model
  // passthrough.
  const isExternalAgent = config.primaryBehavior === 'external-agent';
  const isChat = (config.primaryBehavior ?? 'chat') === 'chat';
  const productAgentKind: ProductAgentSlug = resolveProductAgentKind(
    config.agentKind,
  );
  const credentialPolicy = getCredentialPolicy(productAgentKind);
  // Runtimes that can't reach the platform gateway (e.g. Cursor) are BYO only —
  // there is no managed choice, so force byo and hide the selector.
  const supportsManaged = credentialPolicy.supportsManaged;
  const authMode = supportsManaged ? (config.authMode ?? 'managed') : 'byo';
  const isByo = isExternalAgent && authMode === 'byo';
  const usesRuntimeModelEditor =
    isByo || credentialPolicy.managedSource === 'agent-env';
  const usesGatewayManaged =
    isExternalAgent && !isByo && credentialPolicy.managedSource === 'gateway';

  const handleAuthModeChange = useCallback(
    (next: string) => {
      if (next !== 'managed' && next !== 'byo') return;
      // Switching managed→byo: the saved refs are platform model slugs
      // (`<provider>:<id>`) that mean nothing to a raw provider passthrough,
      // so clear them — the operator re-enters raw ids. supportedModels stays
      // required (≥1); an empty list is valid only transiently in the editor
      // and the save schema enforces the floor.
      if (next === 'byo' && authMode !== 'byo') {
        updateConfig({ authMode: 'byo', supportedModels: [] });
        return;
      }
      updateConfig({ authMode: next });
    },
    [authMode, updateConfig],
  );

  const authModeOptions = useMemo(
    () => [
      {
        value: 'managed',
        label: t('agents.form.byo.managedLabel'),
        description: t('agents.form.byo.managedDescription'),
      },
      {
        value: 'byo',
        label: t('agents.form.byo.byoLabel'),
        description: t('agents.form.byo.byoDescription'),
      },
    ],
    [t],
  );

  return (
    <AgentTabContent>
      {/* No tab-level heading — the tab strip already names the tab (the same
          no-page-title rule as settings pages); the description leads alone. */}
      <Text variant="muted" className="text-sm">
        {t('agents.form.sectionInstructionsDescription')}
      </Text>
      <Stack>
        <Stack gap={3}>
          <HStack justify="between" align="center">
            <label htmlFor="systemInstructions" className="text-sm font-medium">
              {t('agents.form.systemInstructions')}
            </label>
            <Tooltip content={t('agents.form.browsePrompts')} side="top">
              <Button
                variant="ghost"
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
            className="font-mono text-base md:text-sm"
            errorMessage={fieldErrors.systemInstructions}
          />
        </Stack>
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
      </Stack>

      {isExternalAgent && supportsManaged && (
        <PageSection
          title={t('agents.form.byo.sectionTitle')}
          description={t('agents.form.byo.sectionDescription')}
        >
          <RadioGroup
            value={authMode}
            onValueChange={handleAuthModeChange}
            options={authModeOptions}
          />
        </PageSection>
      )}

      {usesGatewayManaged && (
        <PageSection
          title={t('agents.form.webTools.sectionTitle')}
          description={t('agents.form.webTools.sectionDescription')}
        >
          <SettingsToggleRow
            checked={config.nativeWebTools ?? false}
            onCheckedChange={(checked) =>
              updateConfig({ nativeWebTools: checked })
            }
            label={t('agents.form.webTools.nativeLabel')}
            description={t('agents.form.webTools.nativeDescription')}
          />
        </PageSection>
      )}

      {usesGatewayManaged && (
        <PageSection
          title={t('agents.form.vision.sectionTitle')}
          description={t('agents.form.vision.sectionDescription')}
        >
          <SearchableSelect
            value={config.visionModel ?? VISION_MODEL_AUTO}
            onValueChange={(value) => {
              // Ignore the spurious empty-string Radix emits on close.
              if (value === '') return;
              updateConfig({
                visionModel: value === VISION_MODEL_AUTO ? undefined : value,
              });
            }}
            options={visionModelOptions}
            label={t('agents.form.vision.label')}
            placeholder={t('agents.form.vision.autoLabel')}
          />
        </PageSection>
      )}

      <PageSection
        id="models"
        title={t('agents.form.sectionModel')}
        description={
          usesRuntimeModelEditor
            ? t('agents.form.byo.modelSectionDescription')
            : t('agents.form.sectionModelDescription')
        }
      >
        {usesRuntimeModelEditor ? (
          <>
            <ByoModelEditor
              models={selectedModels}
              onChange={handleModelsChange}
            />
            <p className="text-muted-foreground text-sm">
              {t('agents.form.byo.modelNote')}
            </p>
          </>
        ) : (
          <ModelSelector
            models={selectedModels}
            onChange={handleModelsChange}
            availableOptions={availableOptions}
            getDisplayName={getDisplayName}
            getProviderName={getProviderName}
            getModelWarning={getModelWarning}
            renderItemAction={renderItemAction}
          />
        )}
        {/* Same error anatomy as the form fields' `errorMessage` (Input /
            Textarea) — the picker is a composite control with no error prop. */}
        {fieldErrors.supportedModels && (
          <p
            role="alert"
            aria-live="polite"
            className="text-destructive flex items-center gap-1.5 text-sm"
          >
            <Info className="size-4" aria-hidden="true" />
            {fieldErrors.supportedModels}
          </p>
        )}
      </PageSection>

      {isChat && (
        <PageSection
          title={t('agents.form.sectionStructuredResponses')}
          description={t('agents.form.sectionStructuredResponsesDescription')}
        >
          <SettingsToggleRow
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
      )}

      <PromptLibraryDialog
        open={promptLibraryOpen}
        onOpenChange={setPromptLibraryOpen}
        onSelectPrompt={(content) => {
          const separator = currentValue.trim() ? '\n\n' : '';
          writeOverride(currentValue + separator + content);
        }}
      />
    </AgentTabContent>
  );
}
