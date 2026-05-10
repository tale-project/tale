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
import { useLocale } from '@/app/hooks/use-locale';
import { useT } from '@/lib/i18n/client';
import { stripModelRefQualifier } from '@/lib/shared/utils/model-ref';
import { resolveModelLocale } from '@/lib/shared/utils/resolve-provider-locale';

import { useChatAgents } from '../../hooks/queries';
import { useEffectiveAgent } from '../../hooks/use-effective-agent';
import { ModelTagIcons } from '../model-tag-icons';
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
  const { locale } = useLocale();
  const { modelA, modelB, setModelA, setModelB } = useArenaMode();
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);

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
        const resolved = resolveModelLocale(model, provider.i18n, locale);
        map.set(model.id, {
          displayName: resolved.displayName || model.displayName,
          description: resolved.description || undefined,
          tags: model.tags ?? [],
        });
      }
    }
    return map;
  }, [providers, locale]);

  const renderTagIcons = useCallback(
    (option: SearchableSelectOption): ReactNode => {
      const info = modelInfoMap.get(stripModelRefQualifier(option.value));
      if (!info?.tags.length) return null;
      return <ModelTagIcons tags={info.tags} t={t} />;
    },
    [modelInfoMap, t],
  );

  const getDisplayName = useCallback(
    (ref: string) => {
      const plain = stripModelRefQualifier(ref);
      return modelInfoMap.get(plain)?.displayName ?? getModelShortName(plain);
    },
    [modelInfoMap],
  );

  // Governance policies match on plain model ids; strip qualifiers before asking.
  const plainModelIds = useMemo(
    () => supportedModels.map(stripModelRefQualifier),
    [supportedModels],
  );
  const { data: accessibleModelIds } = useAccessibleModels(
    organizationId,
    plainModelIds,
  );

  const filteredModels = useMemo(() => {
    if (!accessibleModelIds) return supportedModels;
    const accessible = new Set(accessibleModelIds);
    return supportedModels.filter((ref) =>
      accessible.has(stripModelRefQualifier(ref)),
    );
  }, [supportedModels, accessibleModelIds]);

  const options = useMemo(
    () =>
      filteredModels.map((ref) => ({
        value: ref,
        label: getDisplayName(ref),
        description: modelInfoMap.get(stripModelRefQualifier(ref))?.description,
      })),
    [filteredModels, getDisplayName, modelInfoMap],
  );

  const currentModelA = modelA ?? filteredModels[0] ?? null;
  const currentModelB =
    modelB ?? filteredModels[1] ?? filteredModels[0] ?? null;

  // Sync default selections back to context so sendMessage can read them
  useEffect(() => {
    if (filteredModels.length >= 2) {
      if (!modelA && filteredModels[0]) {
        setModelA(filteredModels[0]);
      }
      if (!modelB && filteredModels[1]) {
        setModelB(filteredModels[1]);
      }
    }
  }, [filteredModels, modelA, modelB, setModelA, setModelB]);

  if (filteredModels.length < 2) return null;

  return (
    <div className="flex items-center gap-3 px-2">
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
          contentClassName="w-[22rem]"
          searchPlaceholder={t('modelSelector.searchPlaceholder')}
          emptyText={t('modelSelector.noResults')}
          aria-label={t('arena.modelA')}
          optionAction={renderTagIcons}
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
          contentClassName="w-[22rem]"
          searchPlaceholder={t('modelSelector.searchPlaceholder')}
          emptyText={t('modelSelector.noResults')}
          aria-label={t('arena.modelB')}
          optionAction={renderTagIcons}
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
