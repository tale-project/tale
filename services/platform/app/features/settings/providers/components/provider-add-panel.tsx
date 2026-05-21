'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { CollapsibleGuide } from '@/app/components/ui/data-display/collapsible-guide';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { modelTagLiterals } from '@/lib/shared/schemas/providers';

import {
  useFetchProviderModels,
  useSaveProvider,
  useSaveProviderSecret,
} from '../hooks/mutations';
import { readConvexErrorData } from '../utils/error-dispatch';
import { modelTagLabel } from '../utils/model-tag-label';

type ModelEntry = {
  id: string;
  displayName: string;
  tags: Array<(typeof modelTagLiterals)[number]>;
};

type FormData = {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: ModelEntry[];
};

interface ProviderAddPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

function emptyModel(): ModelEntry {
  return { id: '', displayName: '', tags: ['chat'] };
}

/** Derive a readable display name from a model ID (e.g. "gpt-4o" → "GPT-4o"). */
function displayNameFromId(id: string): string {
  return id;
}

export function ProviderAddPanel({
  open,
  onOpenChange,
  organizationId,
}: ProviderAddPanelProps) {
  const { t } = useT('settings');
  const navigate = useNavigate();
  const { t: tCommon } = useT('common');
  const { data: organization } = useOrganization(organizationId);
  const orgSlug = organization?.slug ?? '';
  const { mutateAsync: saveProvider } = useSaveProvider();
  const { mutateAsync: saveProviderSecret } = useSaveProviderSecret();
  const { mutateAsync: fetchModels, isPending: isFetching } =
    useFetchProviderModels();

  // Fetched model IDs from the provider endpoint
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  // Paginate the visible model rows. Default cap mirrors the design — show
  // a handful of rows, then expose "Show more" so users can expand in chunks
  // without scrolling through hundreds of fetched models.
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('providers.name'),
            }),
          )
          .regex(/^[a-z][a-z0-9-]*$/, t('providers.namePatternError')),
        displayName: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('providers.displayName'),
          }),
        ),
        baseUrl: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('providers.baseUrl'),
            }),
          )
          .url(tCommon('validation.url')),
        apiKey: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('providers.apiKey'),
          }),
        ),
        models: z
          .array(
            z.object({
              id: z.string().min(1, t('providers.modelIdRequired')),
              displayName: z
                .string()
                .min(1, t('providers.displayNameRequired')),
              tags: z
                .array(z.enum(modelTagLiterals))
                .min(1, t('providers.tagsRequired')),
            }),
          )
          .min(1, t('providers.modelsRequired'))
          .superRefine((models, ctx) => {
            // Two-pass duplicate detection: collect every id that
            // appears more than once, then flag every row carrying
            // that id (not just the second+ occurrence). The previous
            // single-pass form left the original row unhighlighted, so
            // users would delete the wrong entry.
            const counts = new Map<string, number>();
            for (const m of models) {
              if (!m.id) continue;
              counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
            }
            for (let i = 0; i < models.length; i++) {
              const id = models[i].id;
              if (id && (counts.get(id) ?? 0) > 1) {
                ctx.addIssue({
                  code: 'custom',
                  message: t('providers.duplicateModelId'),
                  path: [i, 'id'],
                });
              }
            }
          }),
      }),
    [t, tCommon],
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting, isValid, errors },
    reset,
    watch,
    getValues,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      displayName: '',
      baseUrl: '',
      apiKey: '',
      models: [],
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control,
    name: 'models',
  });

  const watchedModels = watch('models');
  const fetchCredsBaseUrl = watch('baseUrl');
  const fetchCredsApiKey = watch('apiKey');

  // Snapshot of the (baseUrl, apiKey) the last fetch ran against — when the
  // current form values drift from this, the cached fetched list belongs to
  // different credentials, so we clear it and re-expose the Fetch button.
  const [fetchedCredentials, setFetchedCredentials] = useState<{
    baseUrl: string;
    apiKey: string;
  } | null>(null);

  useEffect(() => {
    if (!fetchedCredentials) return;
    if (
      fetchCredsBaseUrl !== fetchedCredentials.baseUrl ||
      fetchCredsApiKey !== fetchedCredentials.apiKey
    ) {
      setFetchedModels([]);
      setHasFetched(false);
      setFetchError(null);
      setFetchedCredentials(null);
    }
  }, [fetchCredsBaseUrl, fetchCredsApiKey, fetchedCredentials]);

  // ── Fetch models from provider ──────────────────────────────────────

  const handleFetchModels = useCallback(async () => {
    const { baseUrl, apiKey } = getValues();
    if (!baseUrl || !apiKey) return;

    setFetchError(null);
    try {
      const result = await fetchModels({ orgSlug, baseUrl, apiKey });
      const ids = result.map((m) => m.id);
      setFetchedModels(ids);
      // Fetched models default to UNCHECKED. Selecting a row IS the add
      // action, so we don't pre-append anything to the form here.
      setHasFetched(true);
      setFetchedCredentials({ baseUrl, apiKey });
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setFetchError(t('providers.fetchModelsError'));
      setHasFetched(false);
      setFetchedCredentials(null);
    }
  }, [fetchModels, getValues, orgSlug, t]);

  // A fetched model row's checkbox toggles its presence in the form.
  const handleToggleFetchedModel = useCallback(
    (modelId: string, checked: boolean) => {
      const idx = watchedModels.findIndex((m) => m.id === modelId);
      if (checked && idx === -1) {
        append({ id: modelId, displayName: modelId, tags: ['chat'] });
      } else if (!checked && idx !== -1) {
        remove(idx);
      }
    },
    [watchedModels, append, remove],
  );

  // Unified row list: fetched models (in provider order) followed by any
  // manually-added models. Rows know which source they came from so the UI
  // can render a checkbox (fetched) or trash (manual) accordingly.
  type RowEntry = {
    id: string;
    source: 'fetched' | 'manual';
    formIndex: number | null;
  };
  const rows = useMemo<RowEntry[]>(() => {
    const addedById = new Map<string, number>();
    watchedModels.forEach((m, i) => addedById.set(m.id, i));
    const fetchedSet = new Set(fetchedModels);
    const fetchedRows: RowEntry[] = fetchedModels.map((id) => ({
      id,
      source: 'fetched',
      formIndex: addedById.get(id) ?? null,
    }));
    const manualRows: RowEntry[] = watchedModels
      .map((m, i): RowEntry | null =>
        fetchedSet.has(m.id)
          ? null
          : { id: m.id, source: 'manual', formIndex: i },
      )
      .filter((r): r is RowEntry => r !== null);
    return [...fetchedRows, ...manualRows];
  }, [fetchedModels, watchedModels]);

  const filteredRows = useMemo(() => {
    const base = !modelSearch.trim()
      ? rows
      : (() => {
          const query = modelSearch.toLowerCase().trim();
          return rows.filter((r) => {
            const model =
              r.formIndex != null ? watchedModels[r.formIndex] : null;
            const haystack = [r.id, model?.displayName ?? '']
              .join(' ')
              .toLowerCase();
            return haystack.includes(query);
          });
        })();
    // Selected (added) rows float to the top so toggling a checkbox visibly
    // promotes the row. Stable sort preserves the natural fetched/manual
    // ordering within each group, so the list doesn't reshuffle arbitrarily.
    return base
      .map((row, idx) => ({ row, idx }))
      .sort((a, b) => {
        const aSelected = a.row.formIndex != null ? 0 : 1;
        const bSelected = b.row.formIndex != null ? 0 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        return a.idx - b.idx;
      })
      .map((entry) => entry.row);
  }, [rows, modelSearch, watchedModels]);

  // Reset pagination whenever the filtered set changes shape — a new search
  // query or a fresh fetch should land the user at the top of the list, not
  // at whatever expanded cap they had on the previous result set.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [modelSearch, fetchedModels]);

  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount],
  );

  // ── Manual add/edit dialog ──────────────────────────────────────────

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogModel, setDialogModel] = useState(emptyModel());
  const [dialogErrors, setDialogErrors] = useState<
    Partial<Record<keyof ModelEntry, string>>
  >({});

  const openAddDialog = useCallback(() => {
    setEditingIndex(null);
    setDialogModel(emptyModel());
    setDialogErrors({});
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback(
    (index: number) => {
      setEditingIndex(index);
      const model = watchedModels[index];
      setDialogModel({
        id: model.id,
        displayName: model.displayName,
        tags: [...model.tags],
      });
      setDialogErrors({});
      setDialogOpen(true);
    },
    [watchedModels],
  );

  const validateDialog = useCallback((): boolean => {
    const errs: Partial<Record<keyof ModelEntry, string>> = {};
    if (!dialogModel.id.trim()) {
      errs.id = t('providers.modelIdRequired');
    } else {
      const isDuplicate = watchedModels.some(
        (m, i) => i !== editingIndex && m.id === dialogModel.id.trim(),
      );
      if (isDuplicate) {
        errs.id = t('providers.duplicateModelId');
      }
    }
    if (!dialogModel.displayName.trim()) {
      errs.displayName = t('providers.displayNameRequired');
    }
    if (dialogModel.tags.length === 0) {
      errs.tags = t('providers.tagsRequired');
    }
    setDialogErrors(errs);
    return Object.keys(errs).length === 0;
  }, [dialogModel, watchedModels, editingIndex, t]);

  const handleDialogSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!validateDialog()) return;
      const trimmed: ModelEntry = {
        id: dialogModel.id.trim(),
        displayName: dialogModel.displayName.trim(),
        tags: dialogModel.tags,
      };
      if (editingIndex === null) {
        append(trimmed);
      } else {
        update(editingIndex, trimmed);
      }
      setDialogOpen(false);
    },
    [validateDialog, dialogModel, editingIndex, append, update],
  );

  const handleDialogTagToggle = useCallback(
    (tag: (typeof modelTagLiterals)[number], checked: boolean) => {
      setDialogModel((prev) => ({
        ...prev,
        tags: checked
          ? [...prev.tags, tag]
          : prev.tags.filter((v) => v !== tag),
      }));
    },
    [],
  );

  const dialogIsValid =
    dialogModel.id.trim().length > 0 &&
    dialogModel.displayName.trim().length > 0 &&
    dialogModel.tags.length > 0;

  // ── Panel open/close ────────────────────────────────────────────────

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        reset();
        setFetchedModels([]);
        setFetchError(null);
        setHasFetched(false);
        setModelSearch('');
        setVisibleCount(PAGE_SIZE);
      }
      onOpenChange(isOpen);
    },
    [reset, onOpenChange],
  );

  const [overwritePrompt, setOverwritePrompt] = useState<{
    kind: 'encrypted_no_key' | 'undecryptable_existing';
    path: string;
    reason?: string;
    pendingFormData: FormData;
  } | null>(null);
  const [creating, setCreating] = useState(false);

  const finalizeProvider = useCallback(
    (providerName: string) => {
      toast({ title: t('providers.created'), variant: 'success' });
      reset();
      onOpenChange(false);
      void navigate({
        to: '/dashboard/$id/settings/providers/$providerName',
        params: { id: organizationId, providerName },
      });
    },
    [navigate, onOpenChange, organizationId, reset, t],
  );

  const performCreate = useCallback(
    async (data: FormData, force: boolean) => {
      setCreating(true);
      try {
        // Save the secret FIRST. Until the secret save succeeds (possibly
        // after a force-confirm round-trip), the provider config is not
        // written — so cancelling the overwrite dialog leaves zero state on
        // disk instead of a half-baked config-without-secret entry that
        // would otherwise show in the provider list with no way to flag it.
        await saveProviderSecret({
          orgSlug,
          providerName: data.name,
          apiKey: data.apiKey,
          force: force || undefined,
        });
        await saveProvider({
          orgSlug,
          providerName: data.name,
          config: {
            displayName: data.displayName,
            baseUrl: data.baseUrl,
            models: data.models.map((m) => ({
              id: m.id,
              displayName: m.displayName,
              tags: m.tags,
            })),
          },
        });
        setOverwritePrompt(null);
        finalizeProvider(data.name);
      } catch (error) {
        const errData = readConvexErrorData(error);
        if (
          errData?.code === 'PROVIDER_SECRET_REFUSED_OVERWRITE' &&
          (errData.kind === 'encrypted_no_key' ||
            errData.kind === 'undecryptable_existing')
        ) {
          setOverwritePrompt({
            kind: errData.kind,
            path: typeof errData.path === 'string' ? errData.path : '',
            reason:
              typeof errData.reason === 'string' ? errData.reason : undefined,
            pendingFormData: data,
          });
        } else if (errData?.code === 'FORBIDDEN_DEVELOPER_SETTINGS') {
          setOverwritePrompt(null);
          toast({
            title: t('providers.forbiddenDeveloperSettings'),
            variant: 'destructive',
          });
        } else {
          // Non-overwrite failure (e.g. saveProvider zod-shape on second
          // step, network error). Clear any open confirm dialog so the toast
          // isn't hidden behind it.
          setOverwritePrompt(null);
          console.error(error);
          toast({
            title: t('providers.createFailed'),
            variant: 'destructive',
          });
        }
      } finally {
        setCreating(false);
      }
    },
    [finalizeProvider, orgSlug, saveProvider, saveProviderSecret, t],
  );

  const onSubmit = async (data: FormData) => {
    await performCreate(data, false);
  };

  const handleConfirmOverwrite = useCallback(() => {
    if (!overwritePrompt) return;
    void performCreate(overwritePrompt.pendingFormData, true);
  }, [overwritePrompt, performCreate]);

  const watchedBaseUrl = watch('baseUrl');
  const watchedApiKey = watch('apiKey');
  const canFetch =
    !isFetching &&
    watchedBaseUrl.length > 0 &&
    watchedApiKey.length > 0 &&
    z.string().url().safeParse(watchedBaseUrl).success;

  // Auto-fetch models once credentials look valid. Debounced so we don't
  // hammer the endpoint while the user is still typing the key. Only fires
  // when we haven't fetched yet for this credential pair — the
  // fetchedCredentials cleanup effect above clears `hasFetched` if either
  // field changes, so a user fixing a typo will naturally re-trigger this.
  useEffect(() => {
    if (!canFetch || hasFetched) return;
    const handle = setTimeout(() => {
      void handleFetchModels();
    }, 500);
    return () => clearTimeout(handle);
  }, [canFetch, hasFetched, handleFetchModels]);

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title={t('providers.addProvider')}
      size="md"
      hideClose
      className="flex flex-col gap-0 overflow-hidden p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('providers.addProvider')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => handleOpenChange(false)}
        />
      </HStack>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          <Stack gap={4}>
            {!(hasFetched && rows.length > 0) && (
              <CollapsibleGuide
                label={t('providers.byomGuidanceTitle')}
                content={t('providers.byomGuidance')}
                defaultOpen
              />
            )}

            <Input
              id="name"
              label={t('providers.name')}
              {...register('name')}
              placeholder={t('providers.namePlaceholder')}
              errorMessage={errors.name?.message}
            />
            <Text variant="caption" className="-mt-2">
              {t('providers.nameHelp')}
            </Text>

            <Input
              id="displayName"
              label={t('providers.displayName')}
              {...register('displayName')}
              placeholder={t('providers.displayNamePlaceholder')}
              errorMessage={errors.displayName?.message}
            />

            <Input
              id="baseUrl"
              label={t('providers.baseUrl')}
              {...register('baseUrl')}
              placeholder={t('providers.baseUrlPlaceholder')}
              errorMessage={errors.baseUrl?.message}
            />

            <Input
              id="apiKey"
              label={t('providers.apiKey')}
              type="password"
              {...register('apiKey')}
              placeholder={t('providers.apiKeyPlaceholder')}
              errorMessage={errors.apiKey?.message}
              autoComplete="off"
            />

            {/* ── Models section ─────────────────────────────── */}
            <Stack gap={3}>
              <HStack justify="between" align="center">
                <Text className="text-sm font-medium">
                  {t('providers.models')}
                </Text>
                <HStack gap={2} align="center">
                  {canFetch && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleFetchModels()}
                      disabled={isFetching}
                    >
                      {isFetching ? (
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 size-3.5" />
                      )}
                      {t('providers.fetchModels')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={openAddDialog}
                  >
                    <Plus className="mr-1 size-3.5" />
                    {t('providers.addModel')}
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

              {errors.models?.root?.message && (
                <Text
                  variant="caption"
                  className="text-destructive text-sm"
                  role="alert"
                >
                  {errors.models.root.message}
                </Text>
              )}

              {isFetching && rows.length === 0 && (
                <div
                  className="border-border flex items-center justify-center gap-2 rounded-lg border px-4 py-8"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                  <Text variant="caption" className="text-muted-foreground">
                    {t('providers.fetchingModels')}
                  </Text>
                </div>
              )}

              {rows.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  <div className="border-border border-b px-3 py-2">
                    <SearchInput
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={t('providers.searchModels')}
                      className="h-6 w-full bg-transparent ring-0! ring-transparent!"
                    />
                  </div>
                  <Stack gap={0}>
                    {filteredRows.length === 0 && (
                      <div className="flex flex-col items-center justify-center gap-1 px-4 py-8">
                        <Text className="text-sm font-medium">
                          {t('providers.modelsEmpty.searchTitle')}
                        </Text>
                        <Text
                          variant="caption"
                          className="text-muted-foreground text-[12px]"
                        >
                          {t('providers.modelsEmpty.searchDescription')}
                        </Text>
                      </div>
                    )}
                    {visibleRows.map((row, rowIdx) => {
                      const model =
                        row.formIndex != null
                          ? watchedModels[row.formIndex]
                          : null;
                      const [primaryTag, ...restTags] = model?.tags ?? [];
                      const overflowCount = restTags.length;
                      const isLast =
                        rowIdx === visibleRows.length - 1 &&
                        visibleRows.length === filteredRows.length;
                      const isAdded = row.formIndex != null;
                      return (
                        <HStack
                          key={`${row.source}:${row.id}`}
                          justify="between"
                          align="center"
                          gap={4}
                          className={
                            isLast
                              ? 'px-4 py-2.5'
                              : 'border-border border-b px-4 py-2.5'
                          }
                        >
                          <HStack gap={3} align="center" className="min-w-0">
                            {row.source === 'fetched' && (
                              <Checkbox
                                checked={isAdded}
                                onCheckedChange={(checked) =>
                                  handleToggleFetchedModel(
                                    row.id,
                                    checked === true,
                                  )
                                }
                                aria-label={
                                  isAdded
                                    ? t('providers.removeModel')
                                    : t('providers.addModel')
                                }
                              />
                            )}
                            <Text className="truncate text-[13px] font-medium">
                              {model?.displayName ?? row.id}
                            </Text>
                          </HStack>
                          <HStack gap={3} align="center" className="shrink-0">
                            {isAdded && primaryTag && (
                              <HStack gap={1} align="center">
                                <Badge
                                  variant="outline"
                                  className="bg-muted text-muted-foreground border-transparent px-1.5 py-0.5 text-[11px]"
                                >
                                  {modelTagLabel(primaryTag, t)}
                                </Badge>
                                {overflowCount > 0 && (
                                  <Badge
                                    variant="outline"
                                    title={restTags
                                      .map((tag) => modelTagLabel(tag, t))
                                      .join(', ')}
                                    className="bg-muted text-muted-foreground border-transparent px-1.5 py-0.5 text-[11px]"
                                  >
                                    +{overflowCount}
                                  </Badge>
                                )}
                              </HStack>
                            )}
                            {isAdded && row.formIndex != null && (
                              <IconButton
                                type="button"
                                icon={Pencil}
                                aria-label={t('providers.editModel')}
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground size-7"
                                onClick={() => openEditDialog(row.formIndex!)}
                              />
                            )}
                            {row.source === 'manual' &&
                              row.formIndex != null && (
                                <IconButton
                                  type="button"
                                  icon={Trash2}
                                  aria-label={t('providers.removeModel')}
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive size-7"
                                  onClick={() => remove(row.formIndex!)}
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
          </Stack>
        </div>

        <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
          <HStack justify="end" align="center">
            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {tCommon('actions.adding')}
                </>
              ) : (
                t('providers.addProvider')
              )}
            </Button>
          </HStack>
        </div>
      </form>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editingIndex === null
            ? t('providers.addModel')
            : t('providers.editModel')
        }
        onSubmit={handleDialogSave}
        submitText={
          editingIndex === null
            ? t('providers.addModel')
            : tCommon('actions.save')
        }
        isValid={dialogIsValid}
      >
        <Input
          label={t('providers.modelId')}
          value={dialogModel.id}
          onChange={(e) =>
            setDialogModel((prev) => ({ ...prev, id: e.target.value }))
          }
          placeholder={t('providers.modelIdPlaceholder')}
          errorMessage={dialogErrors.id}
        />

        <Input
          label={t('providers.displayName')}
          value={dialogModel.displayName}
          onChange={(e) =>
            setDialogModel((prev) => ({
              ...prev,
              displayName: e.target.value,
            }))
          }
          placeholder={t('providers.modelDisplayNamePlaceholder')}
          errorMessage={dialogErrors.displayName}
        />

        <Stack gap={2}>
          <Text variant="caption" className="text-sm font-medium">
            {t('providers.tags')}
          </Text>
          <HStack gap={4} align="center" className="flex-wrap">
            {modelTagLiterals.map((tag) => (
              <label key={tag} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={dialogModel.tags.includes(tag)}
                  onCheckedChange={(checked) =>
                    handleDialogTagToggle(tag, checked === true)
                  }
                />
                {modelTagLabel(tag, t)}
              </label>
            ))}
          </HStack>
          {dialogErrors.tags && (
            <Text
              variant="caption"
              className="text-destructive text-sm"
              role="alert"
            >
              {dialogErrors.tags}
            </Text>
          )}
        </Stack>
      </FormDialog>
      <ConfirmDialog
        open={overwritePrompt != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOverwritePrompt(null);
        }}
        title={t('providers.overwriteUnreadableTitle')}
        description={
          overwritePrompt
            ? overwritePrompt.kind === 'encrypted_no_key'
              ? t('providers.overwriteEncryptedNoKeyDescription', {
                  path: overwritePrompt.path,
                })
              : t('providers.overwriteUndecryptableDescription', {
                  path: overwritePrompt.path,
                  reason: overwritePrompt.reason ?? '',
                })
            : ''
        }
        confirmText={t('providers.overwriteAnywayConfirm')}
        variant="destructive"
        isLoading={creating}
        onConfirm={handleConfirmOverwrite}
      />
    </Sheet>
  );
}
