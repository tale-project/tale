'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
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
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { modelTagLiterals } from '@/lib/shared/schemas/providers';

import {
  useFetchProviderModels,
  useSaveProvider,
  useSaveProviderSecret,
} from '../hooks/mutations';
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
  const { mutateAsync: saveProvider } = useSaveProvider();
  const { mutateAsync: saveProviderSecret } = useSaveProviderSecret();
  const { mutateAsync: fetchModels, isPending: isFetching } =
    useFetchProviderModels();

  // Fetched model IDs from the provider endpoint
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState(new Set<string>());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

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
            const seen = new Set<string>();
            for (let i = 0; i < models.length; i++) {
              const id = models[i].id;
              if (id && seen.has(id)) {
                ctx.addIssue({
                  code: 'custom',
                  message: t('providers.duplicateModelId'),
                  path: [i, 'id'],
                });
              }
              seen.add(id);
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

  // ── Fetch models from provider ──────────────────────────────────────

  const handleFetchModels = useCallback(async () => {
    const { baseUrl, apiKey } = getValues();
    if (!baseUrl || !apiKey) return;

    setFetchError(null);
    try {
      const result = await fetchModels({ baseUrl, apiKey });
      const ids = result.map((m) => m.id);
      setFetchedModels(ids);
      // Auto-select all fetched models, excluding any already added manually
      const existingIds = new Set(watchedModels.map((m) => m.id));
      setSelectedModelIds(new Set(ids.filter((id) => !existingIds.has(id))));
      setHasFetched(true);
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setFetchError(t('providers.fetchModelsError'));
      setHasFetched(false);
    }
  }, [fetchModels, getValues, watchedModels, t]);

  const handleToggleModel = useCallback((modelId: string, checked: boolean) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(modelId);
      } else {
        next.delete(modelId);
      }
      return next;
    });
  }, []);

  // Add selected fetched models to the form's models array
  const handleAddSelectedModels = useCallback(() => {
    const existingIds = new Set(watchedModels.map((m) => m.id));
    for (const id of selectedModelIds) {
      if (!existingIds.has(id)) {
        append({ id, displayName: displayNameFromId(id), tags: ['chat'] });
      }
    }
    // Clear fetch state after adding
    setFetchedModels([]);
    setSelectedModelIds(new Set());
    setHasFetched(false);
  }, [selectedModelIds, watchedModels, append]);

  // Filter fetched models to only show ones not already added
  const availableFetchedModels = useMemo(() => {
    const existingIds = new Set(watchedModels.map((m) => m.id));
    return fetchedModels.filter((id) => !existingIds.has(id));
  }, [fetchedModels, watchedModels]);

  // Further filter by search query
  const filteredFetchedModels = useMemo(() => {
    if (!modelSearch.trim()) return availableFetchedModels;
    const query = modelSearch.toLowerCase().trim();
    return availableFetchedModels.filter((id) =>
      id.toLowerCase().includes(query),
    );
  }, [availableFetchedModels, modelSearch]);

  // Tri-state checkbox: checked | unchecked | indeterminate
  const allCheckboxState = useMemo((): boolean | 'indeterminate' => {
    if (filteredFetchedModels.length === 0) return false;
    const selectedCount = filteredFetchedModels.filter((id) =>
      selectedModelIds.has(id),
    ).length;
    if (selectedCount === 0) return false;
    if (selectedCount === filteredFetchedModels.length) return true;
    return 'indeterminate';
  }, [filteredFetchedModels, selectedModelIds]);

  const handleToggleAllModels = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedModelIds((prev) => {
          const next = new Set(prev);
          for (const id of filteredFetchedModels) {
            next.add(id);
          }
          return next;
        });
      } else {
        setSelectedModelIds((prev) => {
          const next = new Set(prev);
          for (const id of filteredFetchedModels) {
            next.delete(id);
          }
          return next;
        });
      }
    },
    [filteredFetchedModels],
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
        setSelectedModelIds(new Set());
        setFetchError(null);
        setHasFetched(false);
        setModelSearch('');
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
          orgSlug: 'default',
          providerName: data.name,
          apiKey: data.apiKey,
          force: force || undefined,
        });
        await saveProvider({
          orgSlug: 'default',
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
        if (
          error instanceof ConvexError &&
          error.data?.code === 'PROVIDER_SECRET_REFUSED_OVERWRITE' &&
          (error.data.kind === 'encrypted_no_key' ||
            error.data.kind === 'undecryptable_existing')
        ) {
          setOverwritePrompt({
            kind: error.data.kind,
            path: typeof error.data.path === 'string' ? error.data.path : '',
            reason:
              typeof error.data.reason === 'string'
                ? error.data.reason
                : undefined,
            pendingFormData: data,
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
    [finalizeProvider, saveProvider, saveProviderSecret, t],
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
            {!(hasFetched && availableFetchedModels.length > 0) && (
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
                {hasFetched && availableFetchedModels.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canFetch}
                    onClick={handleFetchModels}
                  >
                    {isFetching ? (
                      <>
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                        {t('providers.fetchingModels')}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-1 size-3.5" />
                        {t('providers.fetchModels')}
                      </>
                    )}
                  </Button>
                ) : (
                  <HStack gap={2}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!canFetch}
                      onClick={handleFetchModels}
                    >
                      {isFetching ? (
                        <>
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                          {t('providers.fetchingModels')}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-1 size-3.5" />
                          {t('providers.fetchModels')}
                        </>
                      )}
                    </Button>
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
                )}
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

              {/* Fetched models checklist */}
              {hasFetched && availableFetchedModels.length > 0 && (
                <Stack gap={2}>
                  <HStack gap={2} align="center">
                    <Checkbox
                      checked={allCheckboxState}
                      onCheckedChange={(checked) =>
                        handleToggleAllModels(checked === true)
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <SearchInput
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={t('providers.searchModels')}
                      />
                    </div>
                  </HStack>
                  <div className="max-h-80 overflow-y-auto">
                    <Stack gap={1}>
                      {filteredFetchedModels.map((modelId) => (
                        <label
                          key={modelId}
                          className="hover:bg-accent flex items-center gap-2 rounded px-1 py-0.5 text-sm"
                        >
                          <Checkbox
                            checked={selectedModelIds.has(modelId)}
                            onCheckedChange={(checked) =>
                              handleToggleModel(modelId, checked === true)
                            }
                          />
                          <span className="font-mono text-xs">{modelId}</span>
                        </label>
                      ))}
                    </Stack>
                  </div>
                  {selectedModelIds.size > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleAddSelectedModels}
                      className="self-start"
                    >
                      <Plus className="mr-1 size-3.5" />
                      {t('providers.modelsSelected', {
                        count: selectedModelIds.size,
                      })}
                    </Button>
                  )}
                </Stack>
              )}

              {hasFetched &&
                availableFetchedModels.length === 0 &&
                fetchedModels.length > 0 && (
                  <Text variant="muted" className="text-sm">
                    {t('providers.modelsSelected', {
                      count: watchedModels.length,
                    })}
                  </Text>
                )}

              {/* Added models list */}
              {fields.length > 0 && (
                <Stack gap={2}>
                  {fields.map((field, index) => (
                    <div key={field.id} className="rounded-lg border p-3">
                      <HStack justify="between" align="start">
                        <Stack gap={1} className="min-w-0 flex-1">
                          <Text className="text-muted-foreground font-mono text-xs">
                            {watchedModels[index]?.id}
                          </Text>
                          <HStack gap={2} align="center" className="flex-wrap">
                            <Text className="text-sm font-medium">
                              {watchedModels[index]?.displayName}
                            </Text>
                            {watchedModels[index]?.tags.map((tag) => (
                              <Badge key={tag} variant="outline">
                                {modelTagLabel(tag, t)}
                              </Badge>
                            ))}
                          </HStack>
                        </Stack>
                        <HStack gap={1} className="shrink-0">
                          <IconButton
                            type="button"
                            icon={Pencil}
                            aria-label={t('providers.editModel')}
                            className="text-muted-foreground size-7"
                            onClick={() => openEditDialog(index)}
                          />
                          <IconButton
                            type="button"
                            icon={Trash2}
                            aria-label={t('providers.removeModel')}
                            className="text-muted-foreground hover:text-destructive size-7"
                            onClick={() => remove(index)}
                          />
                        </HStack>
                      </HStack>
                    </div>
                  ))}
                </Stack>
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
