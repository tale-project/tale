'use client';

import { ChevronDown, Cpu } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import { useEffectiveAgent } from '../hooks/use-effective-agent';

interface ModelSelectorProps {
  organizationId: string;
}

function getModelShortName(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export function ModelSelector({ organizationId }: ModelSelectorProps) {
  const { t } = useT('chat');
  const effectiveAgent = useEffectiveAgent(organizationId);
  const { agents } = useChatAgents(organizationId);
  const { providers } = useListProviders('default');
  const { selectedModelOverrides, setSelectedModelOverride } = useChatLayout();
  const [open, setOpen] = useState(false);

  const supportedModels = useMemo(() => {
    const agent = agents?.find((a) => a.name === effectiveAgent?.name);
    return agent?.supportedModels ?? [];
  }, [agents, effectiveAgent?.name]);

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

  const getDisplayName = useCallback(
    (modelId: string) =>
      modelDisplayNames.get(modelId) ?? getModelShortName(modelId),
    [modelDisplayNames],
  );

  const currentModelId =
    (effectiveAgent?.name && selectedModelOverrides[effectiveAgent.name]) ||
    supportedModels[0] ||
    null;

  // Clear stale override when agent changes
  useEffect(() => {
    if (!effectiveAgent?.name) return;
    const override = selectedModelOverrides[effectiveAgent.name];
    if (override && !supportedModels.includes(override)) {
      setSelectedModelOverride(effectiveAgent.name, null);
    }
  }, [
    effectiveAgent?.name,
    supportedModels,
    selectedModelOverrides,
    setSelectedModelOverride,
  ]);

  const handleSelect = useCallback(
    (modelId: string) => {
      if (!effectiveAgent?.name) return;
      if (modelId === supportedModels[0]) {
        setSelectedModelOverride(effectiveAgent.name, null);
      } else {
        setSelectedModelOverride(effectiveAgent.name, modelId);
      }
    },
    [effectiveAgent?.name, supportedModels, setSelectedModelOverride],
  );

  if (!currentModelId) return null;

  const currentLabel = getDisplayName(currentModelId);

  // Single model — show as read-only text
  if (supportedModels.length <= 1) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Cpu className="size-3.5" aria-hidden="true" />
        <span>{currentLabel}</span>
      </span>
    );
  }

  const options = supportedModels.map((modelId) => ({
    value: modelId,
    label: getDisplayName(modelId),
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
      contentClassName="w-[16.25rem]"
      searchPlaceholder={t('modelSelector.searchPlaceholder')}
      emptyText={t('modelSelector.noResults')}
      aria-label={t('modelSelector.label')}
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
