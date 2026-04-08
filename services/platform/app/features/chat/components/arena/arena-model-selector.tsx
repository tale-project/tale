'use client';

import { ChevronDown, Cpu } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { useChatAgents } from '../../hooks/queries';
import { useEffectiveAgent } from '../../hooks/use-effective-agent';
import { useArenaMode } from './arena-mode-context';

interface ArenaModelSelectorProps {
  organizationId: string;
}

function getModelShortName(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export function ArenaModelSelector({
  organizationId,
}: ArenaModelSelectorProps) {
  const { t } = useT('chat');
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const { agents } = useChatAgents(organizationId);
  const { providers } = useListProviders('default');
  const { modelA, modelB, setModelA, setModelB } = useArenaMode();
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);

  const supportedModels = useMemo(() => {
    const agent = agents?.find((a) => a.name === effectiveAgent?.name);
    return agent?.supportedModels ?? [];
  }, [agents, effectiveAgent?.name]);

  const modelDisplayNames = useMemo(() => {
    const map = new Map();
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

  const options = useMemo(
    () =>
      supportedModels.map((modelId) => ({
        value: modelId,
        label: getDisplayName(modelId),
      })),
    [supportedModels, getDisplayName],
  );

  const currentModelA = modelA ?? supportedModels[0] ?? null;
  const currentModelB =
    modelB ?? supportedModels[1] ?? supportedModels[0] ?? null;

  if (supportedModels.length < 2) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">A</span>
        <SearchableSelect
          value={currentModelA}
          onValueChange={setModelA}
          options={options}
          open={openA}
          onOpenChange={setOpenA}
          align="start"
          side="top"
          sideOffset={8}
          contentClassName="w-[16.25rem]"
          searchPlaceholder={t('modelSelector.searchPlaceholder')}
          emptyText={t('modelSelector.noResults')}
          aria-label={t('arena.modelA')}
          trigger={
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
              aria-label={t('arena.modelA')}
            >
              <Cpu className="size-3.5" aria-hidden="true" />
              <span>
                {currentModelA
                  ? getDisplayName(currentModelA)
                  : t('arena.selectModel')}
              </span>
              <ChevronDown className="size-3" aria-hidden="true" />
            </button>
          }
        />
      </div>
      <span className="text-muted-foreground text-xs">{t('arena.vs')}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">B</span>
        <SearchableSelect
          value={currentModelB}
          onValueChange={setModelB}
          options={options}
          open={openB}
          onOpenChange={setOpenB}
          align="start"
          side="top"
          sideOffset={8}
          contentClassName="w-[16.25rem]"
          searchPlaceholder={t('modelSelector.searchPlaceholder')}
          emptyText={t('modelSelector.noResults')}
          aria-label={t('arena.modelB')}
          trigger={
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
              aria-label={t('arena.modelB')}
            >
              <Cpu className="size-3.5" aria-hidden="true" />
              <span>
                {currentModelB
                  ? getDisplayName(currentModelB)
                  : t('arena.selectModel')}
              </span>
              <ChevronDown className="size-3" aria-hidden="true" />
            </button>
          }
        />
      </div>
    </div>
  );
}
