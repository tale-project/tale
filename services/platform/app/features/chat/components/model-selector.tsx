'use client';

import startCase from 'lodash/startCase';
import { AlertTriangle, ChevronDown, Cpu } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Button } from '@/app/components/ui/primitives/button';
import { useAccessibleModels } from '@/app/features/settings/governance/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useT } from '@/lib/i18n/client';
import {
  parseModelRef,
  stripModelRefQualifier,
} from '@/lib/shared/utils/model-ref';

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
        map.set(model.id, {
          displayName: model.displayName,
          description: model.description || undefined,
          tags: model.tags ?? [],
          providerName: provider.name,
        });
      }
    }
    return map;
  }, [providers]);

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
    return supportedModels.filter((ref) => {
      const info = modelInfoMap.get(stripModelRefQualifier(ref));
      return info?.tags.includes(requiredTag);
    });
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
      const plain = stripModelRefQualifier(ref);
      return modelInfoMap.get(plain)?.displayName ?? getModelShortName(plain);
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
    return {
      value: ref,
      label: getDisplayName(ref),
      labelBadge: providerSlug ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          {startCase(providerSlug)}
        </Badge>
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
