'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import { Grid, HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import {
  DownloadCloud,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { domainLiterals } from '@/lib/shared/constants/domains';
import {
  modelTagLiterals,
  modelTierLiterals,
  SECRETS_ENV_REGEX,
} from '@/lib/shared/schemas/providers';
import { cn } from '@/lib/utils/cn';
import { structuralEqual } from '@/lib/utils/structural-equal';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useFetchConfiguredProviderModels,
  useSaveProviderSecret,
} from '../../hooks/mutations';
import { useProviderConfig } from '../../hooks/use-provider-config-context';
import {
  dispatchForbiddenDeveloperSettings,
  dispatchInvalidProviderConfig,
  dispatchOrgAccessError,
  dispatchVersionConflict,
} from '../../utils/error-dispatch';
import { modelTagLabel } from '../../utils/model-tag-label';
import {
  ModelProviderOptionsField,
  ModelRequestBodyMapField,
  providerOptionsToJsonString,
} from '../provider-options-editor';

interface ModelFormState {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
  dimensions: string;
  inputCostPerMillion: string;
  outputCostPerMillion: string;
  imageCostPerImage: string;
  imageGenerationMode: '' | 'images-api' | 'chat-multimodal';
  baseUrl: string;
  secretsEnv: string;
  apiKey: string;
  providerOptionsJson: string;
  /** Wire-field rename/remove map (rewrites the request body); JSON string. */
  requestBodyMapJson: string;
  /** Hidden from model pickers (still resolvable). Set on superseded models. */
  hidden: boolean;
  // Routing & capabilities (chat models). Strings mirror the input controls;
  // `''`/empty means "unset" → the field is omitted from the saved config.
  tier: '' | 'draft' | 'standard' | 'frontier';
  qualityScore: string;
  contextWindow: string;
  maxOutputTokens: string;
  routingTags: Array<(typeof domainLiterals)[number]>;
  reasoningKnob: '' | 'effort' | 'budgetTokens' | 'none';
  reasoningSupportsMinimal: boolean;
  reasoningMinBudgetTokens: string;
  reasoningMaxBudgetTokens: string;
  promptCachingMode: '' | 'explicit-breakpoints' | 'auto-server' | 'none';
  promptCachingMaxBreakpoints: string;
}

const EMPTY_MODEL_FORM: ModelFormState = {
  id: '',
  displayName: '',
  description: '',
  tags: ['chat'],
  dimensions: '',
  inputCostPerMillion: '',
  outputCostPerMillion: '',
  imageCostPerImage: '',
  imageGenerationMode: '',
  baseUrl: '',
  secretsEnv: '',
  apiKey: '',
  providerOptionsJson: '',
  requestBodyMapJson: '',
  hidden: false,
  tier: '',
  qualityScore: '',
  contextWindow: '',
  maxOutputTokens: '',
  routingTags: [],
  reasoningKnob: '',
  reasoningSupportsMinimal: false,
  reasoningMinBudgetTokens: '',
  reasoningMaxBudgetTokens: '',
  promptCachingMode: '',
  promptCachingMaxBreakpoints: '',
};

/**
 * Convert a USD cost-input value into cents for storage. Catalog prices carry
 * sub-cent precision (e.g. GPT-OSS 120B at $0.039/1M → 3.9 cents), so a plain
 * `Math.round(... * 100)` would silently snap 3.9 → 4 on save. Rounding to
 * three decimals of a cent instead preserves every real catalog value while
 * stripping the IEEE-754 noise a bare `× 100` leaves behind (0.039 * 100 =
 * 3.9000000000000004).
 */
function usdInputToCents(usd: string): number {
  return Math.round(Number(usd) * 1e5) / 1e3;
}

export function ModelsSection({
  organizationId,
  providerName,
  maskedModelKeys,
  isLoading,
}: {
  organizationId: string;
  providerName: string;
  maskedModelKeys: Record<string, string>;
  isLoading: boolean;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tAccessDenied } = useT('accessDenied');
  const { config, saveConfig, isSaving } = useProviderConfig();
  const saveSecret = useSaveProviderSecret();
  const {
    mutateAsync: fetchProviderModels,
    isPending: isFetchingFromProvider,
  } = useFetchConfiguredProviderModels();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_MODEL_FORM);
  const [initialForm, setInitialForm] = useState(EMPTY_MODEL_FORM);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [savingSecret, setSavingSecret] = useState(false);
  const [modelKeyAction, setModelKeyAction] = useState<
    'none' | 'remove' | 'replace'
  >('none');
  const modelIdInputRef = useRef<HTMLInputElement>(null);

  // A non-empty model-level secretsEnv must satisfy the reserved-prefix
  // pattern and length cap. Mirrors the provider dialog's `envError` so the
  // model Save button can gate on it (otherwise an invalid name reaches the
  // server and fails with an opaque INVALID_PROVIDER_CONFIG toast).
  const modelSecretsEnvInvalid = useMemo(() => {
    const value = form.secretsEnv.trim();
    if (!value) return false;
    return value.length > 40 || !SECRETS_ENV_REGEX.test(value);
  }, [form.secretsEnv]);

  // Fetched-but-not-yet-configured model IDs from the provider's /models
  // endpoint. Configured models live in config.models — this list holds the
  // delta the user can opt into via checkbox.
  const [fetchedModelIds, setFetchedModelIds] = useState<string[]>([]);
  // Human-readable names the provider reported alongside the ids, so fetched
  // rows show "Claude Opus (latest)" instead of the raw `~anthropic/...` id.
  const [fetchedNames, setFetchedNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [confirmAddModel, setConfirmAddModel] = useState<string | null>(null);
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const handleFetchFromProvider = useCallback(async () => {
    setFetchError(null);
    try {
      const result = await fetchProviderModels({
        organizationId,
        providerName,
      });
      setFetchedModelIds(result.map((m) => m.id));
      setFetchedNames(
        new Map(
          result.flatMap((m) =>
            m.displayName ? [[m.id, m.displayName] as const] : [],
          ),
        ),
      );
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch provider models:', err);
      setFetchError(t('providers.fetchModelsError'));
      // Mark as "attempted" even on failure so the trash gating doesn't keep
      // pretending we have no information. With hasFetched=true + empty
      // fetchedModelIds, every configured model reads as manual, which is
      // the same fallback as before any fetch — but importantly, the loading
      // spinner stops and the user can retry via the Fetch button.
      setHasFetched(true);
    }
  }, [fetchProviderModels, organizationId, providerName, t]);

  // Quick-add a fetched model: same shape as openAddDialog → submit, but
  // skipping the dialog. Defaults to a 'chat' tag matching the add-panel
  // behavior; the user can edit metadata afterwards via the pencil button.
  const quickAddFetchedModel = useCallback(
    async (modelId: string) => {
      const updatedModels = [
        ...config.models,
        {
          id: modelId,
          displayName: fetchedNames.get(modelId) ?? modelId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 'chat' is a valid modelTagLiterals member
          tags: ['chat'] as Array<(typeof modelTagLiterals)[number]>,
        },
      ];
      try {
        await saveConfig({ models: updatedModels });
      } catch (err) {
        if (dispatchOrgAccessError(err, tAccessDenied)) return;
        if (dispatchForbiddenDeveloperSettings(err, t)) return;
        if (dispatchVersionConflict(err, t)) return;
        if (dispatchInvalidProviderConfig(err, t)) return;
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [config.models, fetchedNames, saveConfig, t, tAccessDenied],
  );

  // Cached OpenRouter capabilities for the configured models (+ the model
  // currently being edited). Powers "Fill from catalog" (per model) and
  // "Sync all from catalog" (bulk). The daily cron keeps this fresh;
  // ModelCatalogCard offers a manual refresh.
  const catalogModelIds = useMemo(() => {
    const ids = new Set(config.models.map((m) => m.id));
    if (dialogOpen && form.id.trim()) ids.add(form.id.trim());
    return [...ids];
  }, [config.models, dialogOpen, form.id]);
  const { data: catalogCaps } = useConvexQuery(
    api.model_catalog.queries.getModelCapabilities,
    { organizationId, modelIds: catalogModelIds },
  );
  const capsByModelId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof catalogCaps>[number]>();
    for (const c of catalogCaps ?? []) map.set(c.modelId, c);
    return map;
  }, [catalogCaps]);

  // Pull the live catalog facts (cost, context, reasoning, caching) for the
  // model open in the editor into the form so the operator can review + save.
  // Operator judgment fields (tier, qualityScore) are left untouched — the
  // catalog doesn't carry them.
  const fillFromCatalog = useCallback(() => {
    const cap = capsByModelId.get(form.id.trim());
    if (!cap) {
      toast({ title: t('providers.modelCapabilities.noCatalogData') });
      return;
    }
    setForm((f) => ({
      ...f,
      contextWindow:
        cap.contextWindow != null ? String(cap.contextWindow) : f.contextWindow,
      maxOutputTokens:
        cap.maxOutputTokens != null
          ? String(cap.maxOutputTokens)
          : f.maxOutputTokens,
      inputCostPerMillion:
        cap.inputCentsPerMillion != null
          ? String(cap.inputCentsPerMillion / 100)
          : f.inputCostPerMillion,
      outputCostPerMillion:
        cap.outputCentsPerMillion != null
          ? String(cap.outputCentsPerMillion / 100)
          : f.outputCostPerMillion,
      reasoningKnob: cap.reasoning?.knob ?? f.reasoningKnob,
      reasoningSupportsMinimal:
        cap.reasoning?.supportsMinimal ?? f.reasoningSupportsMinimal,
      reasoningMinBudgetTokens:
        cap.reasoning?.minBudgetTokens != null
          ? String(cap.reasoning.minBudgetTokens)
          : f.reasoningMinBudgetTokens,
      reasoningMaxBudgetTokens:
        cap.reasoning?.maxBudgetTokens != null
          ? String(cap.reasoning.maxBudgetTokens)
          : f.reasoningMaxBudgetTokens,
      promptCachingMode: cap.promptCaching?.mode ?? f.promptCachingMode,
      promptCachingMaxBreakpoints:
        cap.promptCaching?.maxBreakpoints != null
          ? String(cap.promptCaching.maxBreakpoints)
          : f.promptCachingMaxBreakpoints,
    }));
    toast({ title: t('providers.modelCapabilities.filledFromCatalog') });
  }, [capsByModelId, form.id, t]);

  // Bulk variant: merge cached catalog facts into every configured model,
  // filling ONLY fields the operator hasn't already set (config wins), then
  // save once. Mirrors the runtime layering (operator JSON over catalog cache).
  const [syncingAll, setSyncingAll] = useState(false);
  const syncAllFromCatalog = useCallback(async () => {
    let changedModels = 0;
    const updated = config.models.map((m) => {
      const cap = capsByModelId.get(m.id);
      if (!cap) return m;
      const next = { ...m };
      let touched = false;
      if (next.contextWindow == null && cap.contextWindow != null) {
        next.contextWindow = cap.contextWindow;
        touched = true;
      }
      if (next.maxOutputTokens == null && cap.maxOutputTokens != null) {
        next.maxOutputTokens = cap.maxOutputTokens;
        touched = true;
      }
      if (next.reasoning == null && cap.reasoning != null) {
        next.reasoning = cap.reasoning;
        touched = true;
      }
      if (next.promptCaching == null && cap.promptCaching != null) {
        next.promptCaching = cap.promptCaching;
        touched = true;
      }
      const cost = { ...next.cost };
      if (
        cost.inputCentsPerMillion == null &&
        cap.inputCentsPerMillion != null
      ) {
        cost.inputCentsPerMillion = cap.inputCentsPerMillion;
        touched = true;
      }
      if (
        cost.outputCentsPerMillion == null &&
        cap.outputCentsPerMillion != null
      ) {
        cost.outputCentsPerMillion = cap.outputCentsPerMillion;
        touched = true;
      }
      if (Object.keys(cost).length > 0) next.cost = cost;
      if (touched) changedModels++;
      return next;
    });
    if (changedModels === 0) {
      toast({ title: t('providers.modelCapabilities.syncAllNoop') });
      return;
    }
    setSyncingAll(true);
    try {
      await saveConfig({ models: updated });
      toast({
        title: t('providers.modelCapabilities.syncAllDone', {
          count: changedModels,
        }),
      });
    } catch (err) {
      if (dispatchOrgAccessError(err, tAccessDenied)) return;
      if (dispatchForbiddenDeveloperSettings(err, t)) return;
      if (dispatchVersionConflict(err, t)) return;
      if (dispatchInvalidProviderConfig(err, t)) return;
      toast({ title: t('providers.saveFailed'), variant: 'destructive' });
    } finally {
      setSyncingAll(false);
    }
  }, [config.models, capsByModelId, saveConfig, t, tAccessDenied]);

  const openAddDialog = useCallback(() => {
    setEditingIndex(null);
    setForm(EMPTY_MODEL_FORM);
    setInitialForm(EMPTY_MODEL_FORM);
    setModelKeyAction('none');
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback(
    (index: number) => {
      const model = config.models[index];
      if (!model) return;
      setEditingIndex(index);
      const formData: ModelFormState = {
        id: model.id,
        displayName: model.displayName,
        description: model.description ?? '',
        tags: [...model.tags],
        dimensions: model.dimensions != null ? String(model.dimensions) : '',
        inputCostPerMillion:
          model.cost?.inputCentsPerMillion != null
            ? String(model.cost.inputCentsPerMillion / 100)
            : '',
        outputCostPerMillion:
          model.cost?.outputCentsPerMillion != null
            ? String(model.cost.outputCentsPerMillion / 100)
            : '',
        imageCostPerImage:
          model.cost?.imageCentsPerImage != null
            ? String(model.cost.imageCentsPerImage / 100)
            : '',
        imageGenerationMode: model.imageGenerationMode ?? '',
        baseUrl: model.baseUrl ?? '',
        // Hydrate the saved per-model env-var name (issue #1711) — omitting
        // this would reset it to '' and wipe the binding on the next save.
        secretsEnv: model.secretsEnv ?? '',
        apiKey: '',
        providerOptionsJson: providerOptionsToJsonString(model.providerOptions),
        requestBodyMapJson: providerOptionsToJsonString(model.requestBodyMap),
        hidden: model.hidden ?? false,
        tier: model.tier ?? '',
        qualityScore:
          model.qualityScore != null ? String(model.qualityScore) : '',
        contextWindow:
          model.contextWindow != null ? String(model.contextWindow) : '',
        maxOutputTokens:
          model.maxOutputTokens != null ? String(model.maxOutputTokens) : '',
        routingTags: [...(model.routingTags ?? [])],
        reasoningKnob: model.reasoning?.knob ?? '',
        reasoningSupportsMinimal: model.reasoning?.supportsMinimal ?? false,
        reasoningMinBudgetTokens:
          model.reasoning?.minBudgetTokens != null
            ? String(model.reasoning.minBudgetTokens)
            : '',
        reasoningMaxBudgetTokens:
          model.reasoning?.maxBudgetTokens != null
            ? String(model.reasoning.maxBudgetTokens)
            : '',
        promptCachingMode: model.promptCaching?.mode ?? '',
        promptCachingMaxBreakpoints:
          model.promptCaching?.maxBreakpoints != null
            ? String(model.promptCaching.maxBreakpoints)
            : '',
      };
      setForm(formData);
      setInitialForm(formData);
      setModelKeyAction('none');
      setDialogOpen(true);
    },
    [config.models],
  );

  const handleSubmitModel = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const hasTokenCost =
        !!form.inputCostPerMillion || !!form.outputCostPerMillion;
      const hasImageCost = !!form.imageCostPerImage;
      const cost =
        hasTokenCost || hasImageCost
          ? {
              ...(hasTokenCost
                ? {
                    inputCentsPerMillion: form.inputCostPerMillion
                      ? usdInputToCents(form.inputCostPerMillion)
                      : 0,
                    outputCentsPerMillion: form.outputCostPerMillion
                      ? usdInputToCents(form.outputCostPerMillion)
                      : 0,
                  }
                : {}),
              ...(hasImageCost
                ? {
                    imageCentsPerImage: usdInputToCents(form.imageCostPerImage),
                  }
                : {}),
            }
          : undefined;
      const isImageGen = form.tags.includes('image-generation');
      // Both editors are JsonInput bound to an object schema
      // (providerOptionsClientSchema / requestBodyMapClientSchema): the field
      // only emits JSON that already parses and satisfies the schema, so these
      // parses can't throw and a non-object can't reach here.
      let providerOptions: Record<string, unknown> | undefined;
      const trimmedProviderOptions = form.providerOptionsJson.trim();
      if (trimmedProviderOptions) {
        const parsed: unknown = JSON.parse(trimmedProviderOptions);
        if (isRecord(parsed) && Object.keys(parsed).length > 0) {
          providerOptions = parsed;
        }
      }
      let requestBodyMap:
        | { rename?: Record<string, string>; remove?: string[] }
        | undefined;
      const trimmedRequestBodyMap = form.requestBodyMapJson.trim();
      if (trimmedRequestBodyMap) {
        const parsed: unknown = JSON.parse(trimmedRequestBodyMap);
        if (isRecord(parsed) && Object.keys(parsed).length > 0) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape is checked client-side by requestBodyMapClientSchema and authoritatively by providerJsonSchema.parse on save
          requestBodyMap = parsed as {
            rename?: Record<string, string>;
            remove?: string[];
          };
        }
      }
      const reasoning = form.reasoningKnob
        ? {
            knob: form.reasoningKnob,
            ...(form.reasoningKnob === 'effort' && form.reasoningSupportsMinimal
              ? { supportsMinimal: true }
              : {}),
            ...(form.reasoningKnob === 'budgetTokens' &&
            form.reasoningMinBudgetTokens.trim()
              ? {
                  minBudgetTokens: Math.round(
                    Number(form.reasoningMinBudgetTokens),
                  ),
                }
              : {}),
            ...(form.reasoningKnob === 'budgetTokens' &&
            form.reasoningMaxBudgetTokens.trim()
              ? {
                  maxBudgetTokens: Math.round(
                    Number(form.reasoningMaxBudgetTokens),
                  ),
                }
              : {}),
          }
        : undefined;
      const promptCaching = form.promptCachingMode
        ? {
            mode: form.promptCachingMode,
            ...(form.promptCachingMode === 'explicit-breakpoints' &&
            form.promptCachingMaxBreakpoints.trim()
              ? {
                  maxBreakpoints: Math.round(
                    Number(form.promptCachingMaxBreakpoints),
                  ),
                }
              : {}),
          }
        : undefined;
      // Spread the EXISTING definition first so fields the form doesn't manage
      // (TTS voices/instructions, fallbackModelId, supportsStructuredOutputs …)
      // survive an edit instead of being silently dropped, then override every
      // form-managed field — including clearing capabilities back to undefined.
      const base = editingIndex != null ? config.models[editingIndex] : {};
      const model = {
        ...base,
        id: form.id,
        displayName: form.displayName,
        description: form.description || undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tags are constrained to modelTagLiterals values
        tags: form.tags as Array<(typeof modelTagLiterals)[number]>,
        dimensions: form.dimensions ? Number(form.dimensions) : undefined,
        imageGenerationMode:
          isImageGen && form.imageGenerationMode
            ? form.imageGenerationMode
            : undefined,
        baseUrl: form.baseUrl.trim() || undefined,
        secretsEnv: form.secretsEnv.trim() || undefined,
        hidden: form.hidden || undefined,
        cost,
        providerOptions,
        requestBodyMap,
        tier: form.tier || undefined,
        qualityScore: form.qualityScore.trim()
          ? Number(form.qualityScore)
          : undefined,
        contextWindow: form.contextWindow.trim()
          ? Math.round(Number(form.contextWindow))
          : undefined,
        maxOutputTokens: form.maxOutputTokens.trim()
          ? Math.round(Number(form.maxOutputTokens))
          : undefined,
        routingTags: form.routingTags.length > 0 ? form.routingTags : undefined,
        reasoning,
        promptCaching,
      };
      const updatedModels =
        editingIndex != null
          ? config.models.map((m, i) => (i === editingIndex ? model : m))
          : [...config.models, model];
      try {
        // Write the per-model secret BEFORE the config update. If the
        // secret write fails (network blip, encryption error) we want to
        // bail out without having persisted a config row that references
        // a key the encrypted file doesn't have.
        if (
          (form.apiKey.trim() || modelKeyAction === 'remove') &&
          organizationId
        ) {
          setSavingSecret(true);
          try {
            await saveSecret.mutateAsync({
              organizationId,
              providerName,
              modelKeys: {
                [form.id]:
                  modelKeyAction === 'remove' ? '' : form.apiKey.trim(),
              },
            });
          } finally {
            setSavingSecret(false);
          }
        }
        await saveConfig({ models: updatedModels });
        setDialogOpen(false);
      } catch (err) {
        if (dispatchOrgAccessError(err, tAccessDenied)) return;
        if (dispatchForbiddenDeveloperSettings(err, t)) return;
        if (dispatchVersionConflict(err, t)) return;
        if (dispatchInvalidProviderConfig(err, t)) return;
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [
      form,
      editingIndex,
      config.models,
      saveConfig,
      saveSecret,
      organizationId,
      providerName,
      modelKeyAction,
      t,
      tAccessDenied,
    ],
  );

  const handleDeleteModel = useCallback(async () => {
    if (deleteIndex == null) return;
    const deletedModel = config.models[deleteIndex];
    try {
      const cleanedDefaults: Record<string, string> = {};
      if (config.defaults) {
        for (const [k, v] of Object.entries(config.defaults)) {
          if (v !== undefined && v !== deletedModel?.id) {
            cleanedDefaults[k] = v;
          }
        }
      }
      const cleanedDefaultsOrUndef =
        Object.keys(cleanedDefaults).length > 0 ? cleanedDefaults : undefined;
      await saveConfig({
        models: config.models.filter((_, i) => i !== deleteIndex),
        defaults: cleanedDefaultsOrUndef,
      });
      if (deletedModel && organizationId) {
        await saveSecret.mutateAsync({
          organizationId,
          providerName,
          modelKeys: { [deletedModel.id]: '' },
        });
      }
      setDeleteIndex(null);
    } catch (err) {
      if (dispatchOrgAccessError(err, tAccessDenied)) return;
      if (dispatchForbiddenDeveloperSettings(err, t)) return;
      if (dispatchVersionConflict(err, t)) return;
      toast({ title: t('providers.saveFailed'), variant: 'destructive' });
    }
  }, [
    deleteIndex,
    config.models,
    config.defaults,
    saveConfig,
    saveSecret,
    organizationId,
    providerName,
    t,
    tAccessDenied,
  ]);

  // Unified row list mirroring the add-panel layout: every configured model
  // sits alongside any fetched-but-not-yet-configured model IDs. Configured
  // rows render the existing edit/delete actions; fetched-only rows expose
  // a checkbox that triggers the confirm-and-add flow.
  type ModelRow =
    | {
        source: 'configured';
        id: string;
        configuredIndex: number;
      }
    | {
        source: 'fetched';
        id: string;
        configuredIndex: null;
      };
  const rows = useMemo<ModelRow[]>(() => {
    const configuredIds = new Set(config.models.map((m) => m.id));
    const configuredRows: ModelRow[] = config.models.map((m, i) => ({
      source: 'configured',
      id: m.id,
      configuredIndex: i,
    }));
    const fetchedRows: ModelRow[] = fetchedModelIds
      .filter((id) => !configuredIds.has(id))
      .map((id) => ({ source: 'fetched', id, configuredIndex: null }));
    return [...configuredRows, ...fetchedRows];
  }, [config.models, fetchedModelIds]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const base = !query
      ? rows
      : rows.filter((row) => {
          const model =
            row.configuredIndex != null
              ? config.models[row.configuredIndex]
              : null;
          const haystack = [
            row.id,
            model?.displayName ?? '',
            model?.description ?? '',
            ...(model?.tags.map((tag) => modelTagLabel(tag, t)) ?? []),
            ...(model?.tags ?? []),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        });
    // Configured (selected) rows float to top, preserving original order
    // within each group. Matches the add-panel toggle behavior.
    return base
      .map((row, idx) => ({ row, idx }))
      .sort((a, b) => {
        const aSel = a.row.source === 'configured' ? 0 : 1;
        const bSel = b.row.source === 'configured' ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        return a.idx - b.idx;
      })
      .map((entry) => entry.row);
  }, [rows, searchQuery, config.models, t]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, fetchedModelIds]);

  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount],
  );

  const fetchedModelIdSet = useMemo(
    () => new Set(fetchedModelIds),
    [fetchedModelIds],
  );

  return (
    <>
      <Stack gap={3}>
        <HStack justify="between" align="center" wrap className="gap-y-1">
          <Text
            as="h3"
            className="text-foreground min-w-0 text-base leading-tight font-semibold"
          >
            {t('providers.models')}
          </Text>
          <HStack
            gap={1}
            align="center"
            wrap
            className="ml-auto justify-end gap-y-1"
          >
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleFetchFromProvider()}
              disabled={isFetchingFromProvider}
            >
              {isFetchingFromProvider ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 size-3.5" />
              )}
              {t('providers.fetchModels')}
            </Button>
            {capsByModelId.size > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void syncAllFromCatalog()}
                disabled={syncingAll || isSaving}
              >
                {syncingAll ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="mr-1 size-3.5" />
                )}
                {t('providers.modelCapabilities.syncAll')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={openAddDialog}>
              <Plus className="mr-1 size-3.5" />
              {t('providers.addModelShort')}
            </Button>
          </HStack>
        </HStack>

        {fetchError && (
          <Text
            variant="caption"
            className="text-destructive text-sm"
            role="alert"
          >
            {fetchError}
          </Text>
        )}

        {config.models.length === 0 && fetchedModelIds.length === 0 ? (
          <div className="overflow-hidden rounded-xl border">
            <EmptyState
              icon={Layers}
              title={t('providers.modelsEmpty.noModelsTitle')}
              description={t('providers.modelsEmpty.noModelsDescription')}
              action={
                <Button onClick={openAddDialog}>
                  {t('providers.addModelShort')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div className="border-border border-b px-3 py-2.5">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('providers.searchModels')}
                className="h-6 w-full bg-transparent ring-0! ring-transparent!"
              />
            </div>
            <Stack gap={0}>
              {filteredRows.length === 0 && (
                <Stack
                  gap={1}
                  align="center"
                  justify="center"
                  className="px-4 py-8"
                >
                  <Text className="text-sm font-medium">
                    {t('providers.modelsEmpty.searchTitle')}
                  </Text>
                  <Text
                    variant="caption"
                    className="text-muted-foreground text-[12px]"
                  >
                    {t('providers.modelsEmpty.searchDescription')}
                  </Text>
                </Stack>
              )}
              {visibleRows.map((row, rowIdx) => {
                const model =
                  row.configuredIndex != null
                    ? config.models[row.configuredIndex]
                    : null;
                const [primaryTag, ...restTags] = model?.tags ?? [];
                const overflowCount = restTags.length;
                const isLast =
                  rowIdx === visibleRows.length - 1 &&
                  visibleRows.length === filteredRows.length;
                const isConfigured = row.source === 'configured';
                // A configured model is "manual" if a successful fetch didn't
                // surface its ID. If the fetch hasn't succeeded yet, we can't
                // tell — treat as manual so the trash stays available.
                const isManual =
                  isConfigured &&
                  (!hasFetched || !fetchedModelIdSet.has(row.id));
                return (
                  <HStack
                    key={`${row.source}:${row.id}`}
                    justify="between"
                    align="center"
                    gap={4}
                    className={cn(
                      'px-4 py-2.5',
                      !isLast && 'border-border border-b',
                    )}
                  >
                    <HStack gap={3} align="center" className="min-w-0">
                      <SkeletonBox>
                        <Checkbox
                          checked={isConfigured}
                          onCheckedChange={(checked) => {
                            if (checked === true && !isConfigured) {
                              setConfirmAddModel(row.id);
                            } else if (
                              checked === false &&
                              isConfigured &&
                              row.configuredIndex != null
                            ) {
                              setDeleteIndex(row.configuredIndex);
                            }
                          }}
                          aria-label={
                            isConfigured
                              ? t('providers.removeModel')
                              : t('providers.addModel')
                          }
                        />
                      </SkeletonBox>
                      <Text className="truncate text-[13px] font-medium">
                        <SkeletonBox>
                          {model?.displayName ??
                            fetchedNames.get(row.id) ??
                            row.id}
                        </SkeletonBox>
                      </Text>
                    </HStack>
                    <HStack gap={3} align="center" className="shrink-0">
                      {isConfigured && primaryTag && (
                        <HStack gap={1} align="center">
                          <SkeletonBox>
                            <Badge
                              variant="outline"
                              className="bg-muted text-muted-foreground border-transparent px-1.5 py-0.5 text-[11px]"
                            >
                              {modelTagLabel(primaryTag, t)}
                            </Badge>
                          </SkeletonBox>
                          {overflowCount > 0 && (
                            <Tooltip
                              content={restTags
                                .map((tag) => modelTagLabel(tag, t))
                                .join(', ')}
                            >
                              <Badge
                                variant="outline"
                                className="bg-muted text-muted-foreground border-transparent px-1.5 py-0.5 text-[11px]"
                              >
                                +{overflowCount}
                              </Badge>
                            </Tooltip>
                          )}
                        </HStack>
                      )}
                      {!isLoading &&
                        isConfigured &&
                        row.configuredIndex != null && (
                          <IconButton
                            icon={Pencil}
                            aria-label={t('providers.editModel')}
                            variant="ghost"
                            className="text-muted-foreground hover:text-foreground size-7"
                            onClick={() => openEditDialog(row.configuredIndex)}
                          />
                        )}
                      {!isLoading &&
                        isManual &&
                        row.configuredIndex != null && (
                          <IconButton
                            icon={Trash2}
                            aria-label={t('providers.removeModel')}
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive size-7"
                            onClick={() => setDeleteIndex(row.configuredIndex)}
                          />
                        )}
                    </HStack>
                  </HStack>
                );
              })}
            </Stack>
            {filteredRows.length > PAGE_SIZE && (
              <HStack
                justify="between"
                align="center"
                gap={2}
                className="border-border bg-muted/30 border-t px-4 py-2"
              >
                <Text
                  variant="caption"
                  className="text-muted-foreground text-[12px]"
                >
                  {t('providers.showingModels', {
                    filtered: visibleRows.length,
                    total: filteredRows.length,
                  })}
                </Text>
                {visibleRows.length < filteredRows.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="text-foreground hover:text-foreground/80 text-[12px] font-medium"
                  >
                    {t('providers.showMoreModels')}
                  </button>
                )}
              </HStack>
            )}
          </div>
        )}
      </Stack>

      <Sheet
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setForm(EMPTY_MODEL_FORM);
        }}
        title={
          editingIndex != null
            ? t('providers.editModel')
            : t('providers.addModel')
        }
        size="md"
        hideClose
        className="flex flex-col gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => modelIdInputRef.current?.focus());
        }}
      >
        <HStack
          justify="between"
          align="center"
          className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
        >
          <Text variant="label" className="text-base font-semibold">
            {editingIndex != null
              ? t('providers.editModel')
              : t('providers.addModel')}
          </Text>
          <IconButton
            icon={X}
            aria-label={tCommon('aria.close')}
            variant="ghost"
            onClick={() => {
              setDialogOpen(false);
              setForm(EMPTY_MODEL_FORM);
            }}
          />
        </HStack>

        <form
          onSubmit={handleSubmitModel}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:px-6 sm:py-5">
            <Stack gap={4}>
              <Input
                ref={modelIdInputRef}
                label={t('providers.modelId')}
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder={t('providers.modelIdPlaceholder')}
              />
              <Input
                label={t('providers.displayName')}
                value={form.displayName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, displayName: e.target.value }))
                }
                placeholder={t('providers.modelDisplayNamePlaceholder')}
              />
              <Textarea
                label={t('providers.description_field')}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder={t('providers.modelDescriptionPlaceholder')}
                rows={2}
              />
              <Stack gap={2}>
                <Text className="text-sm font-medium">
                  {t('providers.capabilities')}
                </Text>
                <Grid cols={2} className="gap-x-4 gap-y-1.5">
                  {modelTagLiterals.map((tag) => (
                    <Checkbox
                      key={tag}
                      label={modelTagLabel(tag, t)}
                      checked={form.tags.includes(tag)}
                      onCheckedChange={(checked) => {
                        setForm((f) => ({
                          ...f,
                          tags: checked
                            ? [...f.tags, tag]
                            : f.tags.filter((v) => v !== tag),
                        }));
                      }}
                    />
                  ))}
                </Grid>
              </Stack>
              {form.tags.includes('embedding') && (
                <Input
                  label={t('providers.dimensions')}
                  type="number"
                  value={form.dimensions}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dimensions: e.target.value }))
                  }
                  placeholder="e.g., 1536"
                />
              )}
              {form.tags.includes('image-generation') && (
                <Select
                  label={t('providers.imageGenerationMode')}
                  description={t('providers.imageGenerationModeHelp')}
                  value={form.imageGenerationMode || 'default'}
                  onValueChange={(value) =>
                    setForm((f) => ({
                      ...f,
                      imageGenerationMode:
                        value === 'images-api' || value === 'chat-multimodal'
                          ? value
                          : '',
                    }))
                  }
                  options={[
                    {
                      value: 'default',
                      label: `images-api (${t('providers.default')})`,
                    },
                    { value: 'images-api', label: 'images-api' },
                    { value: 'chat-multimodal', label: 'chat-multimodal' },
                  ]}
                />
              )}
              <HStack gap={3}>
                <Input
                  label={t('providers.inputCostLabel')}
                  type="number"
                  value={form.inputCostPerMillion}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      inputCostPerMillion: e.target.value,
                    }))
                  }
                  placeholder={t('providers.inputCostPlaceholder')}
                  min={0}
                  step="any"
                />
                <Input
                  label={t('providers.outputCostLabel')}
                  type="number"
                  value={form.outputCostPerMillion}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      outputCostPerMillion: e.target.value,
                    }))
                  }
                  placeholder={t('providers.outputCostPlaceholder')}
                  min={0}
                  step="any"
                />
              </HStack>
              {form.tags.includes('image-generation') && (
                <Input
                  label={t('providers.imageCostLabel')}
                  type="number"
                  value={form.imageCostPerImage}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      imageCostPerImage: e.target.value,
                    }))
                  }
                  placeholder={t('providers.imageCostPlaceholder')}
                  min={0}
                  step="any"
                />
              )}
              <Text className="text-muted-foreground text-xs">
                {t('providers.costHelp')}
              </Text>
              <Stack gap={1}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.hidden}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, hidden: checked === true }))
                    }
                  />
                  {t('providers.modelHidden')}
                </label>
                <Text className="text-muted-foreground text-xs">
                  {t('providers.modelHiddenHelp')}
                </Text>
              </Stack>
              <Input
                label={t('providers.modelBaseUrl')}
                value={form.baseUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, baseUrl: e.target.value }))
                }
                placeholder={t('providers.modelBaseUrlPlaceholder')}
              />
              <Text className="text-muted-foreground text-xs">
                {t('providers.modelBaseUrlHelp')}
              </Text>
              <Input
                label={t('providers.modelSecretsEnv')}
                value={form.secretsEnv}
                onChange={(e) =>
                  setForm((f) => ({ ...f, secretsEnv: e.target.value }))
                }
                placeholder={t('providers.modelSecretsEnvPlaceholder')}
                errorMessage={
                  modelSecretsEnvInvalid
                    ? t('providers.secretsEnvPatternError')
                    : undefined
                }
              />
              <Text className="text-muted-foreground text-xs">
                {t('providers.modelSecretsEnvHelp')}
              </Text>
              {maskedModelKeys[form.id] && modelKeyAction === 'none' ? (
                <HStack gap={2} align="center" className="flex-wrap">
                  <Badge variant="green" dot>
                    {t('providers.modelApiKeyConfigured')}
                  </Badge>
                  <Text className="text-muted-foreground font-mono text-sm">
                    {maskedModelKeys[form.id]}
                  </Text>
                  <HStack gap={3}>
                    <button
                      type="button"
                      onClick={() => setModelKeyAction('replace')}
                      className="text-muted-foreground hover:text-foreground focus-visible:outline-ring rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {t('providers.editKey')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setModelKeyAction('remove')}
                      className="text-muted-foreground hover:text-destructive text-xs font-medium"
                    >
                      {t('providers.deleteModelApiKey')}
                    </button>
                  </HStack>
                </HStack>
              ) : maskedModelKeys[form.id] && modelKeyAction === 'remove' ? (
                <HStack gap={2} align="center">
                  <Badge variant="outline">
                    {t('providers.modelApiKeyNotConfigured')}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setModelKeyAction('none')}
                    className="text-muted-foreground hover:text-foreground focus-visible:outline-ring rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {t('providers.undoRemoveKey')}
                  </button>
                </HStack>
              ) : (
                <>
                  {modelKeyAction === 'replace' && (
                    <HStack gap={2} align="center">
                      <Badge variant="green" dot>
                        {t('providers.modelApiKeyConfigured')}
                      </Badge>
                      <Text className="text-muted-foreground font-mono text-sm">
                        {maskedModelKeys[form.id]}
                      </Text>
                    </HStack>
                  )}
                  <Input
                    label={t('providers.modelApiKey')}
                    type="password"
                    value={form.apiKey}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, apiKey: e.target.value }))
                    }
                    placeholder={t('providers.modelApiKeyPlaceholder')}
                  />
                  <Text className="text-muted-foreground text-xs">
                    {t('providers.modelApiKeyHelp')}
                  </Text>
                </>
              )}
              {(form.tags.includes('chat') || form.tags.includes('vision')) && (
                <Stack
                  gap={3}
                  className="border-border mt-1 rounded-lg border p-3 sm:p-4"
                >
                  <HStack
                    justify="between"
                    align="start"
                    wrap
                    className="gap-2"
                  >
                    <Stack gap={1} className="min-w-0">
                      <Text className="text-sm font-medium">
                        {t('providers.modelCapabilities.routingTitle')}
                      </Text>
                      <Text className="text-muted-foreground text-xs">
                        {t('providers.modelCapabilities.routingHelp')}
                      </Text>
                    </Stack>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={fillFromCatalog}
                      disabled={!capsByModelId.has(form.id.trim())}
                    >
                      <Sparkles className="mr-1 size-3.5" />
                      {t('providers.modelCapabilities.fillFromCatalog')}
                    </Button>
                  </HStack>

                  <HStack gap={3} align="start" className="flex-wrap">
                    <Select
                      label={t('providers.modelCapabilities.tier')}
                      description={t('providers.modelCapabilities.tierHelp')}
                      value={form.tier || 'auto'}
                      onValueChange={(value) =>
                        setForm((f) => ({
                          ...f,
                          tier:
                            value === 'draft' ||
                            value === 'standard' ||
                            value === 'frontier'
                              ? value
                              : '',
                        }))
                      }
                      options={[
                        {
                          value: 'auto',
                          label: t('providers.modelCapabilities.tierAuto'),
                        },
                        ...modelTierLiterals.map((tierValue) => ({
                          value: tierValue,
                          label: tierValue,
                        })),
                      ]}
                    />
                    <Input
                      label={t('providers.modelCapabilities.qualityScore')}
                      type="number"
                      value={form.qualityScore}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, qualityScore: e.target.value }))
                      }
                      placeholder="0.0 – 1.0"
                      min={0}
                      max={1}
                      step={0.01}
                    />
                  </HStack>

                  <HStack gap={3} align="start" className="flex-wrap">
                    <Input
                      label={t('providers.modelCapabilities.contextWindow')}
                      type="number"
                      value={form.contextWindow}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          contextWindow: e.target.value,
                        }))
                      }
                      placeholder="e.g., 200000"
                      min={1}
                    />
                    <Input
                      label={t('providers.modelCapabilities.maxOutputTokens')}
                      description={t(
                        'providers.modelCapabilities.maxOutputTokensHelp',
                      )}
                      type="number"
                      value={form.maxOutputTokens}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          maxOutputTokens: e.target.value,
                        }))
                      }
                      placeholder="e.g., 16384"
                      min={0}
                    />
                  </HStack>

                  <Select
                    label={t('providers.modelCapabilities.reasoning')}
                    description={t('providers.modelCapabilities.reasoningHelp')}
                    value={form.reasoningKnob || 'unset'}
                    onValueChange={(value) =>
                      setForm((f) => ({
                        ...f,
                        reasoningKnob:
                          value === 'effort' ||
                          value === 'budgetTokens' ||
                          value === 'none'
                            ? value
                            : '',
                      }))
                    }
                    options={[
                      {
                        value: 'unset',
                        label: t('providers.modelCapabilities.notSet'),
                      },
                      {
                        value: 'none',
                        label: t('providers.modelCapabilities.reasoningNone'),
                      },
                      {
                        value: 'effort',
                        label: t('providers.modelCapabilities.reasoningEffort'),
                      },
                      {
                        value: 'budgetTokens',
                        label: t('providers.modelCapabilities.reasoningBudget'),
                      },
                    ]}
                  />
                  {form.reasoningKnob === 'effort' && (
                    <label className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={form.reasoningSupportsMinimal}
                        onCheckedChange={(checked) =>
                          setForm((f) => ({
                            ...f,
                            reasoningSupportsMinimal: checked === true,
                          }))
                        }
                      />
                      {t('providers.modelCapabilities.supportsMinimal')}
                    </label>
                  )}
                  {form.reasoningKnob === 'budgetTokens' && (
                    <HStack gap={3} align="start" className="flex-wrap">
                      <Input
                        label={t('providers.modelCapabilities.minBudgetTokens')}
                        type="number"
                        value={form.reasoningMinBudgetTokens}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            reasoningMinBudgetTokens: e.target.value,
                          }))
                        }
                        placeholder="e.g., 1024"
                        min={1}
                      />
                      <Input
                        label={t('providers.modelCapabilities.maxBudgetTokens')}
                        type="number"
                        value={form.reasoningMaxBudgetTokens}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            reasoningMaxBudgetTokens: e.target.value,
                          }))
                        }
                        placeholder={t('providers.modelCapabilities.optional')}
                        min={1}
                      />
                    </HStack>
                  )}

                  <Select
                    label={t('providers.modelCapabilities.promptCaching')}
                    description={t(
                      'providers.modelCapabilities.promptCachingHelp',
                    )}
                    value={form.promptCachingMode || 'unset'}
                    onValueChange={(value) =>
                      setForm((f) => ({
                        ...f,
                        promptCachingMode:
                          value === 'explicit-breakpoints' ||
                          value === 'auto-server' ||
                          value === 'none'
                            ? value
                            : '',
                      }))
                    }
                    options={[
                      {
                        value: 'unset',
                        label: t('providers.modelCapabilities.notSet'),
                      },
                      {
                        value: 'none',
                        label: t('providers.modelCapabilities.cachingNone'),
                      },
                      {
                        value: 'auto-server',
                        label: t('providers.modelCapabilities.cachingAuto'),
                      },
                      {
                        value: 'explicit-breakpoints',
                        label: t('providers.modelCapabilities.cachingExplicit'),
                      },
                    ]}
                  />
                  {form.promptCachingMode === 'explicit-breakpoints' && (
                    <Input
                      label={t('providers.modelCapabilities.maxBreakpoints')}
                      type="number"
                      value={form.promptCachingMaxBreakpoints}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          promptCachingMaxBreakpoints: e.target.value,
                        }))
                      }
                      placeholder="e.g., 4"
                      min={1}
                    />
                  )}

                  <Stack gap={2}>
                    <Text className="text-sm font-medium">
                      {t('providers.modelCapabilities.routingTags')}
                    </Text>
                    <Text className="text-muted-foreground text-xs">
                      {t('providers.modelCapabilities.routingTagsHelp')}
                    </Text>
                    <Grid cols={2} className="gap-x-4 gap-y-1.5">
                      {domainLiterals.map((domain) => (
                        <Checkbox
                          key={domain}
                          label={domain}
                          checked={form.routingTags.includes(domain)}
                          onCheckedChange={(checked) =>
                            setForm((f) => ({
                              ...f,
                              routingTags: checked
                                ? [...f.routingTags, domain]
                                : f.routingTags.filter((d) => d !== domain),
                            }))
                          }
                        />
                      ))}
                    </Grid>
                  </Stack>
                </Stack>
              )}
              <ModelProviderOptionsField
                value={form.providerOptionsJson}
                onChange={(next) =>
                  setForm((f) => ({ ...f, providerOptionsJson: next }))
                }
                copy={{
                  title: t('providers.providerOptions.modelLevelTitle'),
                  description: t(
                    'providers.providerOptions.modelLevelDescription',
                  ),
                  guideLabel: t('providers.providerOptions.guideLabel'),
                  helpText: t('providers.providerOptions.modelLevelHelp'),
                }}
              />
              <ModelRequestBodyMapField
                value={form.requestBodyMapJson}
                onChange={(next) =>
                  setForm((f) => ({ ...f, requestBodyMapJson: next }))
                }
                copy={{
                  title: t('providers.requestBodyMap.modelLevelTitle'),
                  description: t(
                    'providers.requestBodyMap.modelLevelDescription',
                  ),
                  guideLabel: t('providers.requestBodyMap.guideLabel'),
                  helpText: t('providers.requestBodyMap.modelLevelHelp'),
                }}
              />
            </Stack>
          </div>

          <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
            <HStack justify="end" align="center" gap={2}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDialogOpen(false);
                  setForm(EMPTY_MODEL_FORM);
                }}
                disabled={isSaving || savingSecret}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={
                  isSaving ||
                  savingSecret ||
                  modelSecretsEnvInvalid ||
                  !(
                    form.id.trim().length > 0 &&
                    form.displayName.trim().length > 0 &&
                    (editingIndex == null ||
                      modelKeyAction === 'remove' ||
                      !structuralEqual(form, initialForm))
                  )
                }
              >
                {isSaving || savingSecret ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('providers.saving')}
                  </>
                ) : editingIndex != null ? (
                  t('providers.save')
                ) : (
                  t('providers.addModel')
                )}
              </Button>
            </HStack>
          </div>
        </form>
      </Sheet>

      <ConfirmDialog
        open={deleteIndex != null}
        onOpenChange={(open) => {
          if (!open) setDeleteIndex(null);
        }}
        title={t('providers.deleteModel')}
        description={
          deleteIndex != null
            ? t('providers.deleteModelConfirm', {
                model: config.models[deleteIndex]?.displayName ?? '',
              })
            : undefined
        }
        variant="destructive"
        confirmText={t('providers.deleteModel')}
        isLoading={isSaving}
        onConfirm={() => void handleDeleteModel()}
      />

      <ConfirmDialog
        open={confirmAddModel != null}
        onOpenChange={(open) => {
          if (!open) setConfirmAddModel(null);
        }}
        title={t('providers.addModel')}
        description={
          confirmAddModel != null
            ? t('providers.addModelConfirm', { model: confirmAddModel })
            : undefined
        }
        confirmText={t('providers.addModel')}
        isLoading={isSaving}
        onConfirm={() => {
          if (confirmAddModel != null) {
            const id = confirmAddModel;
            setConfirmAddModel(null);
            void quickAddFetchedModel(id);
          }
        }}
      />
    </>
  );
}
