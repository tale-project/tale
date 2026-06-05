'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ChevronDown,
  Cpu,
  SlidersHorizontal,
} from 'lucide-react';
import {
  memo,
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
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useAccessibleModels } from '@/app/features/settings/governance/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
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
  /** When the chat belongs to a project, restrict the list to the project's
   *  `allowedModels` and float its `recommendedModels` to the top. */
  projectId?: string;
}

function getModelShortName(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export const ModelSelector = memo(function ModelSelector({
  organizationId,
  projectId,
}: ModelSelectorProps) {
  const { t } = useT('chat');
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const { agents, isLoading: agentsLoading } = useChatAgents(organizationId);
  const { providers, isLoading: providersLoading } =
    useListProviders(organizationId);
  const { project } = useProject(
    projectId ? asProjectId(projectId) : undefined,
  );
  const allowedModels = project?.allowedModels;
  const recommendedModels = project?.recommendedModels;
  const recommendedSet = useMemo(
    () => new Set(recommendedModels ?? []),
    [recommendedModels],
  );
  const { locale } = useLocale();
  const { selectedModelOverrides, setSelectedModelOverride } = useChatLayout();
  const [open, setOpen] = useState(false);
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  // Provider/model setup is gated by the `integrations` ability (same gate as
  // the /settings/providers route). Drives whether the no-models hint offers a
  // setup link (admins/devs) or a "ask your admin" message (everyone else).
  const canSetUpProviders = ability.can('write', 'integrations');

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

  // Right-side action per option: the capability tag icons, plus — for admins
  // who can manage providers — a link to that model's provider settings. The
  // link replaces the old always-on provider badge: provenance moves to an
  // affordance that does something, instead of a label repeated on every row.
  const renderOptionAction = useCallback(
    (option: SearchableSelectOption): ReactNode => {
      const info = modelInfoMap.get(stripModelRefQualifier(option.value));
      const providerSlug = canSetUpProviders
        ? getProviderSlug(option.value)
        : undefined;
      if (!info?.tags.length && !providerSlug) return null;
      return (
        <div className="flex shrink-0 items-start gap-1.5">
          {info?.tags.length ? <ModelTagIcons tags={info.tags} t={t} /> : null}
          {providerSlug ? (
            <Tooltip content={t('modelSelector.viewProvider')} side="top">
              <Link
                to="/dashboard/$id/settings/providers/$providerName"
                params={{ id: organizationId, providerName: providerSlug }}
                aria-label={t('modelSelector.viewProvider')}
                className="text-muted-foreground hover:text-foreground mt-0.5 flex items-center rounded-sm transition-colors"
                // Stop the row's select-and-close handler: clicking the link
                // should navigate to provider settings, not pick the model.
                onClick={(e) => e.stopPropagation()}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              </Link>
            </Tooltip>
          ) : null}
        </div>
      );
    },
    [modelInfoMap, canSetUpProviders, getProviderSlug, organizationId, t],
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
    let models = chatModels;
    if (accessibleModelIds) {
      const accessible = new Set(accessibleModelIds);
      models = models.filter((ref) =>
        accessible.has(stripModelRefQualifier(ref)),
      );
    }
    // Project restriction: when the chat belongs to a project that pins an
    // allowed-models list, drop anything outside it.
    if (allowedModels && allowedModels.length > 0) {
      const allowed = new Set(allowedModels);
      models = models.filter((ref) => allowed.has(stripModelRefQualifier(ref)));
    }
    return models;
  }, [chatModels, accessibleModelIds, allowedModels]);

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

  // While agents/providers load, render the REAL closed-trigger Button (same
  // structure the resolved selector shows) and mask ONLY the dynamic label —
  // mirroring the agent selector, where <Skeletonize> wraps the label span, not
  // the whole Button. Wrapping the Button itself made the skeleton render
  // bulkier than the real pill.
  if (isLoading) {
    return (
      <Button
        type="button"
        className="gap-1.5"
        size="icon"
        variant="ghost"
        aria-label={t('modelSelector.label')}
        disabled
      >
        <Cpu className="size-3.5" aria-hidden="true" />
        <Skeletonize loading label={t('modelSelector.label')}>
          <SkeletonBox>
            <span>{t('modelSelector.auto')}</span>
          </SkeletonBox>
        </Skeletonize>
        <ChevronDown className="size-3" aria-hidden="true" />
      </Button>
    );
  }

  if (!filteredModels.length) {
    // Be honest about the cause — only claim what we can actually tell apart
    // from the client. Three distinguishable cases:
    //   1. No model exists anywhere in the org → cold start, needs setup.
    //   2. A project explicitly pins an allowed-models list → project restriction.
    //   3. Everything else (governance policy, the agent's supportedModels not
    //      matching configured models, a missing tag, …) → we genuinely can't
    //      diagnose which from here, so we DON'T assert a specific cause.
    const noProviderConfigured = modelInfoMap.size === 0;
    const projectRestricts = !!allowedModels && allowedModels.length > 0;

    const warningLabel = (
      <span
        className="text-destructive flex items-center gap-1.5 text-xs"
        role="status"
      >
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        <span>{t('modelSelector.noModelsAvailable')}</span>
      </span>
    );

    // Hover guidance is cause- and role-aware. While the ability is still
    // loading we omit role-specific copy to avoid flashing the wrong message.
    let tooltipContent: string | null;
    if (noProviderConfigured) {
      tooltipContent = abilityLoading
        ? null
        : canSetUpProviders
          ? t('modelSelector.noModelsAdminHint')
          : t('modelSelector.noModelsMemberHint');
    } else if (projectRestricts) {
      tooltipContent = t('modelSelector.noModelsRestricted');
    } else {
      // Org has models, but none reach this assistant — cause is not knowable
      // client-side, so the copy stays non-presumptuous.
      tooltipContent = abilityLoading
        ? null
        : canSetUpProviders
          ? t('modelSelector.noModelsAgentHint')
          : t('modelSelector.noModelsMemberHint');
    }

    // Admins/devs get a clickable affordance to where they'd investigate/fix:
    // provider settings. (Covers both the cold-start and the "configured but
    // not reaching this agent" cases — providers is the right starting point.)
    const adminCanAct =
      !abilityLoading && canSetUpProviders && !projectRestricts;
    if (adminCanAct) {
      return (
        <Tooltip content={tooltipContent} side="top">
          <Link
            to="/dashboard/$id/settings/providers"
            params={{ id: organizationId }}
            className="cursor-pointer rounded-sm hover:underline"
            aria-label={
              noProviderConfigured
                ? t('modelSelector.noModelsAdminHint')
                : t('modelSelector.noModelsAgentHint')
            }
          >
            {warningLabel}
          </Link>
        </Tooltip>
      );
    }

    return (
      <Tooltip content={tooltipContent} side="top">
        {warningLabel}
      </Tooltip>
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

  const modelOptions = filteredModels
    .map((ref) => {
      const info = modelInfoMap.get(stripModelRefQualifier(ref));
      const { quantization } = parseModelRef(ref);
      const isRecommended = recommendedSet.has(stripModelRefQualifier(ref));
      const recommendedBadge = isRecommended ? (
        <Badge variant="green" className="text-[10px] font-normal">
          {t('modelSelector.recommended')}
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
        isRecommended,
        labelBadge:
          recommendedBadge || variantBadge ? (
            <>
              {recommendedBadge}
              {variantBadge}
            </>
          ) : undefined,
        description: info?.description,
      };
    })
    // Project-recommended models float to the top; order is otherwise stable.
    .sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended));

  // Auto option only makes sense for chat agents (see comment on isImageGenAgent).
  const options: SearchableSelectOption[] = isImageGenAgent
    ? modelOptions
    : [
        {
          value: AUTO_MODEL,
          label: t('modelSelector.auto'),
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
      tooltip={t('modelSelector.label')}
      tooltipSide="top"
      searchPlaceholder={t('modelSelector.searchPlaceholder')}
      emptyText={t('modelSelector.noResults')}
      aria-label={t('modelSelector.label')}
      optionAction={renderOptionAction}
      showRadio
      trigger={
        <Button
          type="button"
          className="gap-1.5"
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
});
