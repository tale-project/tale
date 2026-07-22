'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ChevronDown, Cpu, Plus } from 'lucide-react';
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
import {
  useListProviders,
  useModelCapabilities,
} from '@/app/features/settings/providers/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { getCredentialPolicy } from '@/lib/agent-adapters/credential-policy';
import { useT } from '@/lib/i18n/client';
import {
  expandModelVariants,
  getVariantBadgeLabel,
} from '@/lib/shared/utils/expand-model-variants';
import {
  parseModelRef,
  stripModelRefQualifier,
} from '@/lib/shared/utils/model-ref';
import {
  resolveModelLocale,
  resolveProviderLocale,
} from '@/lib/shared/utils/resolve-provider-locale';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import { useDefaultModel } from '../hooks/use-default-model';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useThreadAgentLock } from '../hooks/use-thread-agent-lock';
import { ModelInfoPopover } from './model-info-popover';

const AUTO_MODEL = 'auto';

interface ModelSelectorProps {
  organizationId: string;
  /** When the chat belongs to a project, restrict the list to the project's
   *  `allowedModels` and float its `recommendedModels` to the top. */
  projectId?: string;
  /** Current thread. External-agent threads are bound to their agent, so the
   *  model list and overrides must follow the thread's agent — not the global
   *  per-user picker state another thread may have changed. */
  threadId?: string;
  /** Render the trigger full-width with its chevron right-aligned — used in the
   *  mobile combined assistant+model panel, where each row fills the panel. */
  fullWidth?: boolean;
}

function getModelShortName(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export const ModelSelector = memo(function ModelSelector({
  organizationId,
  projectId,
  threadId,
  fullWidth = false,
}: ModelSelectorProps) {
  const { t } = useT('chat');
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const { lockedAgent } = useThreadAgentLock(organizationId, threadId);
  const { agents, isLoading: agentsLoading } = useChatAgents(organizationId);
  const { providers, isLoading: providersLoading } =
    useListProviders(organizationId);
  const { data: governanceDefaultModel } = useDefaultModel(organizationId);
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
  const navigate = useNavigate();
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  // Provider/model setup is gated by the `integrations` ability (same gate as
  // the /settings/providers route). Drives whether the no-models hint offers a
  // setup link (admins/devs) or a "ask your admin" message (everyone else).
  const canSetUpProviders = ability.can('write', 'integrations');
  // Adding a model to an agent edits the agent's config on its Instructions &
  // models page, which is behind the same `agents` write gate as that route —
  // so the "Add model" footer is only offered to users who can act on it.
  const canManageAgents = ability.can('write', 'agents');

  // The thread's bound agent wins over the global per-user selection — a
  // switch made in ANOTHER thread must not surface that agent's model list here.
  const activeAgent = useMemo(
    () => lockedAgent ?? agents?.find((a) => a.name === effectiveAgent?.name),
    [lockedAgent, agents, effectiveAgent?.name],
  );
  const modelAgentKey = activeAgent?.name;

  // Env-backed externals (BYO or managed agent-env) use runtime model ids, not
  // the platform catalog. Their `supportedModels` are raw vendor CLI ids: with
  // one (or none) we show a calm indicator; with several the composer offers a
  // plain picker over those raw ids (no catalog tags / governance filtering).
  const usesRuntimeModels = useMemo(() => {
    if (activeAgent?.primaryBehavior !== 'external-agent') return false;
    if (activeAgent.authMode === 'byo') return true;
    const kind = activeAgent.agentKind ?? 'claude-code';
    if (kind !== 'claude-code' && kind !== 'cursor' && kind !== 'opencode') {
      return false;
    }
    return getCredentialPolicy(kind).managedSource === 'agent-env';
  }, [activeAgent]);

  const supportedModels = useMemo(() => {
    return activeAgent?.supportedModels ?? [];
  }, [activeAgent]);

  const isGatewayManagedExternal = useMemo(() => {
    if (activeAgent?.primaryBehavior !== 'external-agent') return false;
    if (activeAgent.authMode === 'byo') return false;
    const kind = activeAgent.agentKind ?? 'claude-code';
    return getCredentialPolicy(kind).managedSource === 'gateway';
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
        providerDisplayName: string;
        quantizations?: string[];
        hidden?: boolean;
      }
    >();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      const resolvedProvider = resolveProviderLocale(provider, locale);
      for (const model of provider.models) {
        const resolved = resolveModelLocale(model, provider.i18n, locale);
        map.set(model.id, {
          displayName: resolved.displayName || model.displayName,
          description: resolved.description || undefined,
          tags: model.tags ?? [],
          providerName: provider.name,
          providerDisplayName:
            resolvedProvider.displayName ||
            provider.displayName ||
            provider.name,
          quantizations: Array.isArray(model.quantizations)
            ? model.quantizations
            : undefined,
          hidden: model.hidden === true,
        });
      }
    }
    return map;
  }, [providers, locale]);

  // Cached catalog capabilities (cost, context, reasoning, …) for every model
  // we might render, keyed by id — powers the info popover's detail rows.
  const capabilities = useModelCapabilities(organizationId, [
    ...modelInfoMap.keys(),
  ]);

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

  // Right-side action per option: a single info affordance that opens a popover
  // summarising the model's provider, capability types, and — for admins who can
  // manage providers — a link to that provider's settings. Replaces the old
  // capability-icon strip + sliders settings link with one consolidated control.
  const renderOptionAction = useCallback(
    (option: SearchableSelectOption): ReactNode => {
      const modelId = stripModelRefQualifier(option.value);
      const info = modelInfoMap.get(modelId);
      const providerSlug = canSetUpProviders
        ? getProviderSlug(option.value)
        : undefined;
      if (!info) return null;
      return (
        <div className="flex shrink-0 items-start gap-1.5">
          <ModelInfoPopover
            providerName={info.providerDisplayName}
            description={info.description}
            tags={info.tags}
            capabilities={capabilities.get(modelId)}
            providerSlug={providerSlug}
            organizationId={organizationId}
          />
        </div>
      );
    },
    [
      modelInfoMap,
      capabilities,
      canSetUpProviders,
      getProviderSlug,
      organizationId,
    ],
  );

  const chatModels = useMemo(() => {
    // Keep a model the user has already selected even if it's now hidden, so a
    // deprecation doesn't silently reset their explicit choice mid-session.
    const activeOverride = modelAgentKey
      ? selectedModelOverrides[modelAgentKey]
      : undefined;
    const filteredByTag = supportedModels.filter((ref) => {
      const info = modelInfoMap.get(stripModelRefQualifier(ref));
      if (!info?.tags.includes(requiredTag)) return false;
      // Hidden (e.g. superseded older versions) are dropped from the picker but
      // remain fully resolvable, so agents/workflows referencing them still run.
      if (info.hidden && ref !== activeOverride) return false;
      return true;
    });
    // External agents (Claude Code etc.) receive the bare model id — the
    // quantization qualifier is stripped at the gateway boundary
    // (toGatewayModelRef), so offering fp8/fp4 variants would be a no-op
    // choice. Keep one bare entry per model instead.
    if (activeAgent?.primaryBehavior === 'external-agent') {
      return filteredByTag;
    }
    // Split each base model that declares quantizations into one selectable
    // entry per variant (e.g. GLM 5.1 → GLM 5.1 fp8 + GLM 5.1 fp4). Models
    // without a quantizations array are kept as a single entry.
    return expandModelVariants(
      filteredByTag,
      (bareId) => modelInfoMap.get(bareId)?.quantizations,
    );
  }, [
    supportedModels,
    modelInfoMap,
    requiredTag,
    modelAgentKey,
    selectedModelOverrides,
    activeAgent?.primaryBehavior,
  ]);

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

  const resolvedGovernanceDefaultRef = useMemo(() => {
    if (!governanceDefaultModel) return undefined;
    return governanceDefaultModel.providerName
      ? `${governanceDefaultModel.providerName}:${governanceDefaultModel.modelId}`
      : governanceDefaultModel.modelId;
  }, [governanceDefaultModel]);

  const currentModelId = useMemo(() => {
    // User's explicit override (localStorage) takes highest priority
    if (modelAgentKey && selectedModelOverrides[modelAgentKey]) {
      return selectedModelOverrides[modelAgentKey];
    }
    // No override: chat agents show Auto; image-gen agents show the first
    // supported model (which matches what the backend resolves when no
    // override is set — the agent JSON's `supportedModels[0]`).
    if (isImageGenAgent) {
      return filteredModels[0] ?? AUTO_MODEL;
    }
    return AUTO_MODEL;
  }, [modelAgentKey, selectedModelOverrides, isImageGenAgent, filteredModels]);

  // Keep override in sync with filteredModels:
  // - Clear an override that's no longer permitted (e.g. agent changed or
  //   governance policy tightened).
  // - Auto-pin to the single permitted model so the backend uses the same
  //   model the UI displays — otherwise the backend would fall back to
  //   `supportedModels[0]`, which may bypass the model_access allowlist.
  useEffect(() => {
    // Runtime-model externals (BYO / env-managed) don't draw from the catalog,
    // so `filteredModels` is empty for them — skip the catalog reconciliation
    // (a dedicated effect below validates their raw override) to avoid clearing
    // a valid vendor-model choice.
    if (usesRuntimeModels) return;
    if (!modelAgentKey) return;
    const override = selectedModelOverrides[modelAgentKey];
    if (override && !filteredModels.includes(override)) {
      setSelectedModelOverride(modelAgentKey, null);
      return;
    }
    if (!override && !isImageGenAgent && filteredModels.length === 1) {
      setSelectedModelOverride(modelAgentKey, filteredModels[0]);
    }
  }, [
    usesRuntimeModels,
    modelAgentKey,
    filteredModels,
    selectedModelOverrides,
    setSelectedModelOverride,
    isImageGenAgent,
  ]);

  // Runtime-model externals: drop an override that's no longer in the agent's
  // raw `supportedModels` (e.g. the config's model list changed) so the picker
  // and the turn fall back to the pinned first entry.
  useEffect(() => {
    if (!usesRuntimeModels || !modelAgentKey) return;
    const override = selectedModelOverrides[modelAgentKey];
    if (override && !supportedModels.includes(override)) {
      setSelectedModelOverride(modelAgentKey, null);
    }
  }, [
    usesRuntimeModels,
    modelAgentKey,
    supportedModels,
    selectedModelOverrides,
    setSelectedModelOverride,
  ]);

  const handleSelect = useCallback(
    (modelId: string) => {
      if (!modelAgentKey) return;
      if (modelId === AUTO_MODEL) {
        setSelectedModelOverride(modelAgentKey, null);
      } else {
        setSelectedModelOverride(modelAgentKey, modelId);
      }
    },
    [modelAgentKey, setSelectedModelOverride],
  );

  // Runtime-model picker (BYO / env-managed externals): the raw vendor id IS the
  // choice — there is no synthetic "Auto" (a vendor may list its own "auto"),
  // and every option is always a concrete override sent as the turn's modelId.
  const handleRuntimeSelect = useCallback(
    (modelId: string) => {
      if (!modelAgentKey) return;
      setSelectedModelOverride(modelAgentKey, modelId);
    },
    [modelAgentKey, setSelectedModelOverride],
  );

  // "Add model" jumps to the active agent's Instructions & models page, scrolled
  // to the Models section (its `#models` anchor) — that's where an editor adds a
  // model to the agent's list. Mirrors the agent selector's "Add agent" footer.
  const handleAddModelClick = useCallback(() => {
    if (!modelAgentKey) return;
    setOpen(false);
    void navigate({
      to: '/dashboard/$id/agents/$agentId/instructions',
      params: { id: organizationId, agentId: modelAgentKey },
      hash: 'models',
    });
  }, [navigate, organizationId, modelAgentKey]);

  // Compact "Add model" affordance for the states that don't render the picker
  // dropdown (single model, or models configured but none reaching this agent).
  // Same `agents` write gate as the dropdown footer; as a ghost icon button it
  // keeps the composer row's height and sits beside the static label/warning.
  const addModelButton =
    canManageAgents && modelAgentKey ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        icon={Plus}
        title={t('modelSelector.addModel')}
        onClick={handleAddModelClick}
      />
    ) : null;

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
        className={cn('gap-1.5', fullWidth && 'w-full')}
        size="sm"
        variant="ghost"
        aria-label={t('modelSelector.label')}
        disabled
      >
        <Cpu className="size-3.5 shrink-0" aria-hidden="true" />
        <Skeletonize loading label={t('modelSelector.label')}>
          <SkeletonBox>
            <span className="truncate">{t('modelSelector.auto')}</span>
          </SkeletonBox>
        </Skeletonize>
        <ChevronDown
          className={cn('size-3 shrink-0', fullWidth && 'ml-auto')}
          aria-hidden="true"
        />
      </Button>
    );
  }

  if (usesRuntimeModels) {
    // Raw vendor model ids (BYO / env-managed) — not a catalog choice. One (or
    // none) renders a calm read-only indicator; several render a plain picker
    // over the raw ids that sends the pick as the turn's modelId.
    if (supportedModels.length > 1) {
      const runtimeOverride = modelAgentKey
        ? selectedModelOverrides[modelAgentKey]
        : undefined;
      // No override ⇒ the backend pins supportedModels[0], so mirror that here.
      const runtimeCurrent =
        runtimeOverride && supportedModels.includes(runtimeOverride)
          ? runtimeOverride
          : supportedModels[0];
      const runtimeOptions: SearchableSelectOption[] = supportedModels.map(
        (ref) => ({
          value: ref,
          label: getModelShortName(stripModelRefQualifier(ref)),
        }),
      );
      return (
        <SearchableSelect
          value={runtimeCurrent}
          onValueChange={handleRuntimeSelect}
          options={runtimeOptions}
          open={open}
          onOpenChange={setOpen}
          align="start"
          side="top"
          sideOffset={8}
          contentClassName="w-[22rem]"
          tooltip={fullWidth ? undefined : t('modelSelector.label')}
          tooltipSide="top"
          searchPlaceholder={t('modelSelector.searchPlaceholder')}
          emptyText={t('modelSelector.noResults')}
          aria-label={t('modelSelector.label')}
          showRadio
          trigger={
            <Button
              type="button"
              className="gap-1.5"
              variant="ghost"
              size="sm"
              aria-label={t('modelSelector.label')}
            >
              <Cpu className="size-3.5" aria-hidden="true" />
              <span>
                {getModelShortName(stripModelRefQualifier(runtimeCurrent))}
              </span>
              <ChevronDown className="size-3" aria-hidden="true" />
            </Button>
          }
        />
      );
    }
    const rawModel = supportedModels[0];
    return (
      <span
        className="text-muted-foreground flex items-center gap-1.5 text-sm"
        title={t('modelSelector.byoTooltip')}
      >
        <Cpu className="size-3.5" aria-hidden="true" />
        <span className="truncate">
          {rawModel
            ? getModelShortName(stripModelRefQualifier(rawModel))
            : resolvedGovernanceDefaultRef
              ? getDisplayName(resolvedGovernanceDefaultRef)
              : t('modelSelector.byoDefault')}
        </span>
      </span>
    );
  }

  if (isGatewayManagedExternal && supportedModels.length === 0) {
    const label = resolvedGovernanceDefaultRef
      ? getDisplayName(resolvedGovernanceDefaultRef)
      : t('modelSelector.auto');
    return (
      <span
        className="text-muted-foreground flex items-center gap-1.5 text-sm"
        title={t('modelSelector.autoDescription')}
      >
        <Cpu className="size-3.5" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
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
    const warningNode = adminCanAct ? (
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
    ) : (
      <Tooltip content={tooltipContent} side="top">
        {warningLabel}
      </Tooltip>
    );

    // Offer a direct "add model" jump only when editing the agent's own model
    // list is what would actually close the gap: the org has models but none
    // reach this agent. Cold-start (no provider) and project-pinned lists are
    // fixed elsewhere, so we leave those to the provider-setup affordance above.
    if (noProviderConfigured || projectRestricts || !addModelButton) {
      return warningNode;
    }

    return (
      <span className="flex items-center gap-1.5">
        {warningNode}
        {addModelButton}
      </span>
    );
  }

  // Single model — show its name as read-only text (not "Auto", since there's
  // nothing to auto-select between). Editors still get the "add model" jump so
  // they can grow the agent's model list from here.
  if (filteredModels.length === 1) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Cpu className="size-3.5" aria-hidden="true" />
        <span>{getDisplayName(filteredModels[0])}</span>
        {addModelButton}
      </span>
    );
  }

  const currentLabel =
    currentModelId === AUTO_MODEL
      ? t('modelSelector.auto')
      : getDisplayName(currentModelId);

  const modelOptions = filteredModels
    .map((ref) => {
      const { quantization } = parseModelRef(ref);
      const bareId = stripModelRefQualifier(ref);
      const info = modelInfoMap.get(bareId);
      const isRecommended = recommendedSet.has(bareId);
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
      contentClassName="w-[28rem] max-w-[calc(100vw-2rem)]"
      tooltip={fullWidth ? undefined : t('modelSelector.label')}
      tooltipSide="top"
      searchPlaceholder={t('modelSelector.searchPlaceholder')}
      emptyText={t('modelSelector.noResults')}
      aria-label={t('modelSelector.label')}
      optionAction={renderOptionAction}
      showRadio
      footer={
        canManageAgents && modelAgentKey ? (
          <Button
            variant="ghost"
            className="w-full"
            icon={Plus}
            onClick={handleAddModelClick}
          >
            {t('modelSelector.addModel')}
          </Button>
        ) : undefined
      }
      trigger={
        <Button
          type="button"
          className={cn('gap-1.5', fullWidth && 'w-full')}
          variant="ghost"
          size="sm"
          aria-label={t('modelSelector.label')}
        >
          <Cpu className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{currentLabel}</span>
          <ChevronDown
            className={cn('size-3 shrink-0', fullWidth && 'ml-auto')}
            aria-hidden="true"
          />
        </Button>
      }
    />
  );
});
