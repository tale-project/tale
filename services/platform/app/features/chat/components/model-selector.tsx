'use client';

import { ChevronDown, Cpu } from 'lucide-react';
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
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import { useDefaultModel } from '../hooks/use-default-model';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { ModelTagIcons } from './model-tag-icons';

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
  const { agents } = useChatAgents(organizationId);
  const { providers } = useListProviders('default');
  const { selectedModelOverrides, setSelectedModelOverride } = useChatLayout();
  const { data: governanceDefault } = useDefaultModel(organizationId);
  const [open, setOpen] = useState(false);

  const supportedModels = useMemo(() => {
    const agent = agents?.find((a) => a.name === effectiveAgent?.name);
    return agent?.supportedModels ?? [];
  }, [agents, effectiveAgent?.name]);

  const modelInfoMap = useMemo(() => {
    const map = new Map<
      string,
      { displayName: string; description?: string; tags: string[] }
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
        });
      }
    }
    return map;
  }, [providers]);

  const renderTagIcons = useCallback(
    (option: SearchableSelectOption): ReactNode => {
      const info = modelInfoMap.get(option.value);
      if (!info?.tags.length) return null;
      return <ModelTagIcons tags={info.tags} t={t} />;
    },
    [modelInfoMap, t],
  );

  const chatModels = useMemo(() => {
    return supportedModels.filter((modelId) => {
      const info = modelInfoMap.get(modelId);
      return info?.tags.includes('chat');
    });
  }, [supportedModels, modelInfoMap]);

  const { data: accessibleModelIds } = useAccessibleModels(
    organizationId,
    chatModels,
  );

  const filteredModels = useMemo(() => {
    if (!accessibleModelIds) return chatModels;
    return chatModels.filter((id) => accessibleModelIds.includes(id));
  }, [chatModels, accessibleModelIds]);

  const getDisplayName = useCallback(
    (modelId: string) =>
      modelInfoMap.get(modelId)?.displayName ?? getModelShortName(modelId),
    [modelInfoMap],
  );

  const currentModelId = useMemo(() => {
    // 1. User's explicit override (localStorage) takes highest priority
    if (effectiveAgent?.name && selectedModelOverrides[effectiveAgent.name]) {
      return selectedModelOverrides[effectiveAgent.name];
    }
    // 2. Governance team/role default (if model is in agent's supported list)
    if (
      governanceDefault?.modelId &&
      filteredModels.includes(governanceDefault.modelId)
    ) {
      return governanceDefault.modelId;
    }
    // 3. Agent's primary model
    return filteredModels[0] ?? null;
  }, [
    effectiveAgent?.name,
    selectedModelOverrides,
    governanceDefault,
    filteredModels,
  ]);

  // Clear stale override when agent changes
  useEffect(() => {
    if (!effectiveAgent?.name) return;
    const override = selectedModelOverrides[effectiveAgent.name];
    if (override && !filteredModels.includes(override)) {
      setSelectedModelOverride(effectiveAgent.name, null);
    }
  }, [
    effectiveAgent?.name,
    filteredModels,
    selectedModelOverrides,
    setSelectedModelOverride,
  ]);

  const handleSelect = useCallback(
    (modelId: string) => {
      if (!effectiveAgent?.name) return;
      // Only clear the override when the user picks the effective default
      // (governance default if present, otherwise the agent's primary model).
      const effectiveDefault =
        governanceDefault?.modelId &&
        filteredModels.includes(governanceDefault.modelId)
          ? governanceDefault.modelId
          : filteredModels[0];
      if (modelId === effectiveDefault) {
        setSelectedModelOverride(effectiveAgent.name, null);
      } else {
        setSelectedModelOverride(effectiveAgent.name, modelId);
      }
    },
    [
      effectiveAgent?.name,
      filteredModels,
      governanceDefault,
      setSelectedModelOverride,
    ],
  );

  if (!currentModelId) return null;

  const currentLabel = getDisplayName(currentModelId);

  // Single model — show as read-only text
  if (filteredModels.length <= 1) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Cpu className="size-3.5" aria-hidden="true" />
        <span>{currentLabel}</span>
      </span>
    );
  }

  const options = filteredModels.map((modelId) => ({
    value: modelId,
    label: getDisplayName(modelId),
    description: modelInfoMap.get(modelId)?.description,
  }));

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
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
          aria-label={t('modelSelector.label')}
        >
          <Cpu className="size-3.5" aria-hidden="true" />
          <span>{currentLabel}</span>
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      }
    />
  );
}
