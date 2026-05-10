'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import startCase from 'lodash/startCase';
import { AlertTriangle, ChevronDown, Cpu } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useAccessibleModels } from '@/app/features/settings/governance/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useLocale } from '@/app/hooks/use-locale';
import { useT } from '@/lib/i18n/client';
import {
  expandModelVariants,
  getVariantBadgeLabel,
} from '@/lib/shared/utils/expand-model-variants';
import {
  parseModelRef,
  stripModelRefQualifier,
} from '@/lib/shared/utils/model-ref';
import { resolveModelLocale } from '@/lib/shared/utils/resolve-provider-locale';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { ModelTagIcons } from './model-tag-icons';

const AUTO_MODEL = 'auto';

interface ModelSelectorProps {
  organizationId: string;
}

function getModelShortName(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export function ModelSelector({ organizationId }: ModelSelectorProps) {
  const { t } = useT('chat');
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const { agents, isLoading: agentsLoading } = useChatAgents(organizationId);
  const { providers, isLoading: providersLoading } =
    useListProviders('default');
  const { locale } = useLocale();
  const { selectedModelOverrides, setSelectedModelOverride } = useChatLayout();
  const [open, setOpen] = useState(false);

  const activeAgent = useMemo(
    () => agents?.find((a) => a.name === effectiveAgent?.name),
    [agents, effectiveAgent?.name],
  );

  const supportedModels = useMemo(() => {
    return activeAgent?.supportedModels ?? [];
  }, [activeAgent]);

  const requiredTag =
    activeAgent?.primaryBehavior === 'image-generation'
      ? 'image-generation'
      : 'chat';

  const modelInfoMap = useMemo(() => {
    const map = new Map<
      string,
      {
        displayName: string;
        description?: string;
        tags: string[];
        providerName: string;
        quantizations?: string[];
      }
    >();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        const resolved = resolveModelLocale(model, provider.i18n, locale);
        map.set(model.id, {
          displayName: resolved.displayName || model.displayName,
          description: resolved.description || undefined,
          tags: model.tags ?? [],
          providerName: provider.name,
          quantizations: Array.isArray(model.quantizations)
            ? model.quantizations
            : undefined,
        });
      }
    }
    return map;
  }, [providers, locale]);

  // Return the provider's slug (its JSON filename without extension) — this
  // is the stable, machine-readable identifier users write in model refs,
  // not the cosmetic `displayName` from the provider JSON.
  const getProviderSlug = useCallback(
    (ref: string): string | undefined => {
      const parsed = parseModelRef(ref);
      if (parsed.providerName) return parsed.providerName;
      return modelInfoMap.get(parsed.modelId)?.providerName;
    },
    [modelInfoMap],
  );

  const renderTagIcons = useCallback(
    (option: SearchableSelectOption): ReactNode => {
      const info = modelInfoMap.get(stripModelRefQualifier(option.value));
      if (!info?.tags.length) return null;
      return <ModelTagIcons tags={info.tags} t={t} />;
    },
    [modelInfoMap, t],
  );

  const chatModels = useMemo(() => {
    const filteredByTag = supportedModels.filter((ref) => {
      const info = modelInfoMap.get(stripModelRefQualifier(ref));
      return info?.tags.includes(requiredTag);
    });
    // Split each base model that declares quantizations into one selectable
    // entry per variant (e.g. GLM 5.1 → GLM 5.1 fp8 + GLM 5.1 fp4). Models
    // without a quantizations array are kept as a single entry.
    return expandModelVariants(
      filteredByTag,
      (bareId) => modelInfoMap.get(bareId)?.quantizations,
    );
  }, [supportedModels, modelInfoMap, requiredTag]);

  // Governance policies match on plain model ids; strip qualifiers before asking.
  const chatModelPlainIds = useMemo(
    () => chatModels.map(stripModelRefQualifier),
    [chatModels],
  );
  const { data: accessibleModelIds } = useAccessibleModels(
    organizationId,
    chatModelPlainIds,
  );

  const filteredModels = useMemo(() => {
    if (!accessibleModelIds) return chatModels;
    const accessible = new Set(accessibleModelIds);
    return chatModels.filter((ref) =>
      accessible.has(stripModelRefQualifier(ref)),
    );
  }, [chatModels, accessibleModelIds]);

  const getDisplayName = useCallback(
    (ref: string) => {
      const { modelId, quantization } = parseModelRef(ref);
      const base =
        modelInfoMap.get(modelId)?.displayName ?? getModelShortName(modelId);
      // Append the variant in the closed trigger and selected-row label so
      // fp8 vs fp4 selections are distinguishable without opening the menu.
      return quantization
        ? `${base} (${getVariantBadgeLabel(quantization)})`
        : base;
    },
    [modelInfoMap],
  );

  // Auto mode is only meaningful for chat agents, where models are
  // interchangeable from a capability/style standpoint. Image-gen models
  // differ visibly per-model (style, editing ability, cost), so "Auto" would
  // just hide a creative decision behind a vague default — we force an
  // explicit pick instead.
  const isImageGenAgent = requiredTag === 'image-generation';

  const currentModelId = useMemo(() => {
    // User's explicit override (localStorage) takes highest priority
    if (effectiveAgent?.name && selectedModelOverrides[effectiveAgent.name]) {
      return selectedModelOverrides[effectiveAgent.name];
    }
    // No override: chat agents show Auto; image-gen agents show the first
    // supported model (which matches what the backend resolves when no
    // override is set — the agent JSON's `supportedModels[0]`).
    if (isImageGenAgent) {
      return filteredModels[0] ?? AUTO_MODEL;
    }
    return AUTO_MODEL;
  }, [
    effectiveAgent?.name,
    selectedModelOverrides,
    isImageGenAgent,
    filteredModels,
  ]);

  // Keep override in sync with filteredModels:
  // - Clear an override that's no longer permitted (e.g. agent changed or
  //   governance policy tightened).
  // - Auto-pin to the single permitted model so the backend uses the same
  //   model the UI displays — otherwise the backend would fall back to
  //   `supportedModels[0]`, which may bypass the model_access allowlist.
  useEffect(() => {
    if (!effectiveAgent?.name) return;
    const override = selectedModelOverrides[effectiveAgent.name];
    if (override && !filteredModels.includes(override)) {
      setSelectedModelOverride(effectiveAgent.name, null);
      return;
    }
    if (!override && !isImageGenAgent && filteredModels.length === 1) {
      setSelectedModelOverride(effectiveAgent.name, filteredModels[0]);
    }
  }, [
    effectiveAgent?.name,
    filteredModels,
    selectedModelOverrides,
    setSelectedModelOverride,
    isImageGenAgent,
  ]);

  const handleSelect = useCallback(
    (modelId: string) => {
      if (!effectiveAgent?.name) return;
      if (modelId === AUTO_MODEL) {
        setSelectedModelOverride(effectiveAgent.name, null);
      } else {
        setSelectedModelOverride(effectiveAgent.name, modelId);
      }
    },
    [effectiveAgent?.name, setSelectedModelOverride],
  );

  const isLoading = agentsLoading || providersLoading;

  if (isLoading) {
    return <Skeleton className="h-6 w-24" label={t('modelSelector.label')} />;
  }

  if (!filteredModels.length) {
    return (
      <span
        className="text-destructive flex items-center gap-1.5 text-xs"
        role="status"
      >
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        <span>{t('modelSelector.noModelsAvailable')}</span>
      </span>
    );
  }

  // Single model — show its name as read-only text (not "Auto", since there's
  // nothing to auto-select between).
  if (filteredModels.length === 1) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Cpu className="size-3.5" aria-hidden="true" />
        <span>{getDisplayName(filteredModels[0])}</span>
      </span>
    );
  }

  const currentLabel =
    currentModelId === AUTO_MODEL
      ? t('modelSelector.auto')
      : getDisplayName(currentModelId);

  const modelOptions = filteredModels.map((ref) => {
    const info = modelInfoMap.get(stripModelRefQualifier(ref));
    const providerSlug = getProviderSlug(ref);
    const { quantization } = parseModelRef(ref);
    const providerBadge = providerSlug ? (
      <Badge variant="outline" className="text-[10px] font-normal">
        {startCase(providerSlug)}
      </Badge>
    ) : null;
    const variantBadge = quantization ? (
      <Badge variant="outline" className="text-[10px] font-normal">
        {getVariantBadgeLabel(quantization)}
      </Badge>
    ) : null;
    return {
      value: ref,
      label: getDisplayName(ref),
      labelBadge:
        providerBadge || variantBadge ? (
          <>
            {providerBadge}
            {variantBadge}
          </>
        ) : undefined,
      description: info?.description,
    };
  });

  // Auto option only makes sense for chat agents (see comment on isImageGenAgent).
  const options: SearchableSelectOption[] = isImageGenAgent
    ? modelOptions
    : [
        {
          value: AUTO_MODEL,
          label: t('modelSelector.auto'),
          description: t('modelSelector.autoDescription'),
        },
        ...modelOptions,
      ];

  return (
    <SearchableSelect
      value={currentModelId}
      onValueChange={handleSelect}
      options={options}
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="top"
      sideOffset={8}
      contentClassName="w-[22rem]"
      searchPlaceholder={t('modelSelector.searchPlaceholder')}
      emptyText={t('modelSelector.noResults')}
      aria-label={t('modelSelector.label')}
      optionAction={renderTagIcons}
      showRadio
      trigger={
        <Button
          type="button"
          className="gap-2"
          size="icon"
          variant="ghost"
          aria-label={t('modelSelector.label')}
        >
          <Cpu className="size-3.5" aria-hidden="true" />
          <span>{currentLabel}</span>
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      }
    />
  );
}
