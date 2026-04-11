import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Card } from '@/app/components/ui/layout/card';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { useSaveProviderSecret } from '@/app/features/settings/providers/hooks/mutations';
import {
  useHasProviderSecret,
  useReadProvider,
} from '@/app/features/settings/providers/hooks/queries';
import {
  ProviderConfigProvider,
  useProviderConfig,
} from '@/app/features/settings/providers/hooks/use-provider-config-context';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  component: ProviderDetailRoute,
});

function ProviderDetailRoute() {
  const { t } = useT('settings');
  const { id: organizationId, providerName } = Route.useParams();
  const { data, isLoading } = useReadProvider('default', providerName);

  if (isLoading) {
    return <ProviderDetailSkeleton />;
  }

  if (!data?.ok) {
    return (
      <Stack gap={4} className="p-6">
        <Text variant="muted">
          {t('providers.providerNotFound', { name: providerName })}
        </Text>
        <Link
          to="/dashboard/$id/settings/providers"
          params={{ id: organizationId }}
        >
          <Button variant="secondary">{t('providers.backToProviders')}</Button>
        </Link>
      </Stack>
    );
  }

  return (
    <ProviderConfigProvider
      providerName={providerName}
      initialConfig={data.config}
    >
      <ProviderDetailContent
        organizationId={organizationId}
        providerName={providerName}
        maskedModelKeys={data.maskedModelKeys ?? {}}
      />
    </ProviderConfigProvider>
  );
}

function ProviderDetailSkeleton() {
  return (
    <Stack gap={6} className="px-4 py-6">
      <Skeleton className="h-5 w-48" />
      <Card contentClassName="p-5">
        <Stack gap={4}>
          <HStack justify="between" className="border-b pb-4">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-20" />
          </HStack>
          <Stack gap={3} className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <HStack key={i} gap={4} className="pt-3 first:pt-0">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-48" />
              </HStack>
            ))}
          </Stack>
        </Stack>
      </Card>
      <Card contentClassName="p-5">
        <HStack gap={4}>
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-28" />
        </HStack>
      </Card>
      <Card contentClassName="p-5">
        <Stack gap={4}>
          <HStack justify="between" className="border-b pb-4">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-20" />
          </HStack>
          <Stack gap={3} className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <HStack key={i} gap={4} className="pt-3 first:pt-0">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
              </HStack>
            ))}
          </Stack>
        </Stack>
      </Card>
      <Stack gap={3}>
        <HStack justify="between">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-9 w-28" />
        </HStack>
        <Skeleton className="h-64 w-full rounded-lg" />
      </Stack>
    </Stack>
  );
}

function ProviderDetailContent({
  organizationId,
  providerName,
  maskedModelKeys,
}: {
  organizationId: string;
  providerName: string;
  maskedModelKeys: Record<string, string>;
}) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();

  return (
    <Stack gap={6} className="px-4 py-6">
      <HStack gap={2} align="center">
        <Link
          to="/dashboard/$id/settings/providers"
          params={{ id: organizationId }}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          {t('providers.title')}
        </Link>
        <ChevronRight className="text-muted-foreground size-3.5" />
        <Text as="span" className="text-sm font-medium">
          {config.displayName}
        </Text>
      </HStack>

      <GeneralSection />
      <ApiKeySection providerName={providerName} />
      <DefaultModelsSection />
      <ModelsSection
        providerName={providerName}
        maskedModelKeys={maskedModelKeys}
      />
    </Stack>
  );
}

function InfoRow({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <HStack gap={4} className="py-4">
      <Text variant="muted" className="w-40 shrink-0 text-sm">
        {label}
      </Text>
      <div className={muted ? 'text-muted-foreground text-sm' : 'text-sm'}>
        {children}
      </div>
    </HStack>
  );
}

function GeneralSection() {
  const { t } = useT('settings');
  const { config, saveConfig, isSaving } = useProviderConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    displayName: '',
    description: '',
    baseUrl: '',
  });

  const openDialog = useCallback(() => {
    setForm({
      displayName: config.displayName,
      description: config.description ?? '',
      baseUrl: config.baseUrl,
    });
    setDialogOpen(true);
  }, [config]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await saveConfig({
          displayName: form.displayName,
          description: form.description || undefined,
          baseUrl: form.baseUrl,
        });
        setDialogOpen(false);
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [form, saveConfig, t],
  );

  return (
    <>
      <Card contentClassName="p-5">
        <HStack justify="between" align="center" className="border-b pb-4">
          <Text className="text-sm font-semibold">
            {t('providers.general')}
          </Text>
          <button
            type="button"
            onClick={openDialog}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[13px] font-medium"
          >
            <Pencil className="size-3.5" />
            {t('providers.editGeneral')}
          </button>
        </HStack>
        <Stack className="divide-y">
          <InfoRow label={t('providers.displayName')}>
            {config.displayName}
          </InfoRow>
          <InfoRow label={t('providers.description_field')} muted>
            {config.description || '—'}
          </InfoRow>
          <InfoRow label={t('providers.baseUrl')}>{config.baseUrl}</InfoRow>
        </Stack>
      </Card>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t('providers.editGeneral')}
        onSubmit={handleSubmit}
        isSubmitting={isSaving}
        isDirty={
          form.displayName !== config.displayName ||
          form.description !== (config.description ?? '') ||
          form.baseUrl !== config.baseUrl
        }
      >
        <Stack gap={4}>
          <Input
            label={t('providers.displayName')}
            value={form.displayName}
            onChange={(e) =>
              setForm((f) => ({ ...f, displayName: e.target.value }))
            }
            placeholder={t('providers.displayNamePlaceholder')}
            autoFocus
          />
          <Textarea
            label={t('providers.description_field')}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder={t('providers.descriptionPlaceholder')}
            rows={3}
          />
          <Input
            label={t('providers.baseUrl')}
            value={form.baseUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, baseUrl: e.target.value }))
            }
            placeholder={t('providers.baseUrlPlaceholder')}
          />
        </Stack>
      </FormDialog>
    </>
  );
}

function ApiKeySection({ providerName }: { providerName: string }) {
  const { t } = useT('settings');
  const { data: maskedKey } = useHasProviderSecret('default', providerName);
  const hasSecret = maskedKey != null;
  const saveSecret = useSaveProviderSecret();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveKey = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!apiKey.trim()) return;
      setSaving(true);
      try {
        await saveSecret.mutateAsync({
          orgSlug: 'default',
          providerName,
          apiKey: apiKey.trim(),
        });
        setApiKey('');
        setDialogOpen(false);
      } catch {
        toast({
          title: t('providers.secretSaveFailed'),
          variant: 'destructive',
        });
      } finally {
        setSaving(false);
      }
    },
    [apiKey, providerName, saveSecret, t],
  );

  return (
    <>
      <Card contentClassName="p-5">
        <HStack gap={4} align="center">
          <Text className="w-40 shrink-0 text-sm font-semibold">
            {t('providers.apiKey')}
          </Text>
          {hasSecret ? (
            <>
              <Badge variant="green" dot>
                {t('providers.apiKeyConfigured')}
              </Badge>
              <Text className="text-muted-foreground font-mono text-sm">
                {maskedKey}
              </Text>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[13px] font-medium"
              >
                <Pencil className="size-3.5" />
                {t('providers.editKey')}
              </button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              {t('providers.addKey')}
            </Button>
          )}
        </HStack>
      </Card>

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setApiKey('');
        }}
        title={
          hasSecret ? t('providers.replaceApiKey') : t('providers.addApiKey')
        }
        description={
          hasSecret
            ? t('providers.replaceApiKeyDescription', {
                maskedKey: maskedKey ?? '',
              })
            : undefined
        }
        onSubmit={handleSaveKey}
        isSubmitting={saving}
        isDirty={apiKey.trim().length > 0}
        submitText={t('providers.saveKey')}
        submittingText={t('providers.saving')}
      >
        <Input
          type="password"
          placeholder={t('providers.apiKeyEnter')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoFocus
        />
      </FormDialog>
    </>
  );
}

interface ModelFormState {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
  dimensions: string;
  inputCostPerMillion: string;
  outputCostPerMillion: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_MODEL_FORM: ModelFormState = {
  id: '',
  displayName: '',
  description: '',
  tags: ['chat'],
  dimensions: '',
  inputCostPerMillion: '',
  outputCostPerMillion: '',
  baseUrl: '',
  apiKey: '',
};

function ModelsSection({
  providerName,
  maskedModelKeys,
}: {
  providerName: string;
  maskedModelKeys: Record<string, string>;
}) {
  const { t } = useT('settings');
  const { config, saveConfig, isSaving } = useProviderConfig();
  const saveSecret = useSaveProviderSecret();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_MODEL_FORM);
  const [initialForm, setInitialForm] = useState(EMPTY_MODEL_FORM);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [savingSecret, setSavingSecret] = useState(false);
  const [modelKeyAction, setModelKeyAction] = useState<
    'none' | 'remove' | 'replace'
  >('none');

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
      const formData = {
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
        baseUrl: model.baseUrl ?? '',
        apiKey: '',
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
      const cost =
        form.inputCostPerMillion || form.outputCostPerMillion
          ? {
              inputCentsPerMillion: form.inputCostPerMillion
                ? Math.round(Number(form.inputCostPerMillion) * 100)
                : 0,
              outputCentsPerMillion: form.outputCostPerMillion
                ? Math.round(Number(form.outputCostPerMillion) * 100)
                : 0,
            }
          : undefined;
      const model = {
        id: form.id,
        displayName: form.displayName,
        description: form.description || undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tags are constrained to checkbox values
        tags: form.tags as Array<'chat' | 'vision' | 'embedding'>,
        dimensions: form.dimensions ? Number(form.dimensions) : undefined,
        baseUrl: form.baseUrl.trim() || undefined,
        cost,
      };
      const updatedModels =
        editingIndex != null
          ? config.models.map((m, i) => (i === editingIndex ? model : m))
          : [...config.models, model];
      try {
        await saveConfig({ models: updatedModels });
        if (form.apiKey.trim() || modelKeyAction === 'remove') {
          setSavingSecret(true);
          try {
            await saveSecret.mutateAsync({
              orgSlug: 'default',
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
        setDialogOpen(false);
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [
      form,
      editingIndex,
      config.models,
      saveConfig,
      saveSecret,
      providerName,
      modelKeyAction,
      t,
    ],
  );

  const handleDeleteModel = useCallback(async () => {
    if (deleteIndex == null) return;
    const deletedModel = config.models[deleteIndex];
    try {
      await saveConfig({
        models: config.models.filter((_, i) => i !== deleteIndex),
      });
      if (deletedModel) {
        await saveSecret.mutateAsync({
          orgSlug: 'default',
          providerName,
          modelKeys: { [deletedModel.id]: '' },
        });
      }
      setDeleteIndex(null);
    } catch {
      toast({ title: t('providers.saveFailed'), variant: 'destructive' });
    }
  }, [deleteIndex, config.models, saveConfig, saveSecret, providerName, t]);

  return (
    <>
      <Stack gap={3}>
        <HStack justify="between" align="center">
          <Text className="text-base font-semibold">
            {t('providers.models')}
          </Text>
          <Button onClick={openAddDialog}>
            {t('providers.addModelShort')}
          </Button>
        </HStack>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('providers.modelId')}</TableHead>
                <TableHead className="w-[200px]">
                  {t('providers.displayName')}
                </TableHead>
                <TableHead>{t('providers.description_field')}</TableHead>
                <TableHead className="w-[200px]">
                  {t('providers.tags')}
                </TableHead>
                <TableHead className="w-[140px] text-right">
                  Cost / 1M tokens
                </TableHead>
                <TableHead className="w-11" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.models.map((model, index) => (
                <TableRow
                  key={index}
                  className="cursor-pointer"
                  onClick={() => openEditDialog(index)}
                >
                  <TableCell>
                    <HStack gap={2} align="center">
                      <Text className="font-mono text-[13px]">{model.id}</Text>
                      {model.baseUrl && (
                        <Badge variant="outline" className="text-[10px]">
                          {t('providers.modelOverrideIndicator')}
                        </Badge>
                      )}
                      {maskedModelKeys[model.id] && (
                        <Badge variant="outline" className="text-[10px]">
                          {t('providers.modelApiKeyOverrideIndicator')}
                        </Badge>
                      )}
                    </HStack>
                  </TableCell>
                  <TableCell>
                    <Text className="text-sm font-medium">
                      {model.displayName}
                    </Text>
                  </TableCell>
                  <TableCell className="max-w-48">
                    <Text
                      className="text-muted-foreground truncate text-sm"
                      title={model.description ?? ''}
                    >
                      {model.description || '—'}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <HStack gap={1}>
                      {model.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag === 'chat'
                            ? t('providers.tagChat')
                            : tag === 'vision'
                              ? t('providers.tagVision')
                              : tag === 'embedding'
                                ? t('providers.tagEmbedding')
                                : tag}
                        </Badge>
                      ))}
                    </HStack>
                  </TableCell>
                  <TableCell className="text-right">
                    {model.cost ? (
                      <Text className="text-muted-foreground text-xs">
                        ${(model.cost.inputCentsPerMillion / 100).toFixed(2)} /
                        ${(model.cost.outputCentsPerMillion / 100).toFixed(2)}
                      </Text>
                    ) : (
                      <Text className="text-muted-foreground text-xs">—</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton
                      icon={Trash2}
                      aria-label={t('providers.removeModel')}
                      className="text-muted-foreground hover:text-destructive size-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteIndex(index);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Stack>

      <FormDialog
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
        onSubmit={handleSubmitModel}
        isSubmitting={isSaving || savingSecret}
        isDirty={
          form.id.trim().length > 0 &&
          form.displayName.trim().length > 0 &&
          (editingIndex == null ||
            modelKeyAction === 'remove' ||
            JSON.stringify(form) !== JSON.stringify(initialForm))
        }
        submitText={
          editingIndex != null ? t('providers.save') : t('providers.addModel')
        }
        large
        className="sm:max-w-lg"
      >
        <Stack gap={4}>
          <Input
            label={t('providers.modelId')}
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            placeholder={t('providers.modelIdPlaceholder')}
            autoFocus
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
          <HStack gap={4} align="center" className="flex-wrap">
            {(['chat', 'vision', 'embedding'] as const).map((tag) => (
              <label key={tag} className="flex items-center gap-1.5 text-sm">
                <Checkbox
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
                {tag === 'chat'
                  ? t('providers.tagChat')
                  : tag === 'vision'
                    ? t('providers.tagVision')
                    : tag === 'embedding'
                      ? t('providers.tagEmbedding')
                      : tag}
              </label>
            ))}
          </HStack>
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
          <HStack gap={3}>
            <Input
              label="Input cost (USD / 1M tokens)"
              type="number"
              value={form.inputCostPerMillion}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  inputCostPerMillion: e.target.value,
                }))
              }
              placeholder="e.g., 2.50"
              min={0}
              step={0.01}
            />
            <Input
              label="Output cost (USD / 1M tokens)"
              type="number"
              value={form.outputCostPerMillion}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  outputCostPerMillion: e.target.value,
                }))
              }
              placeholder="e.g., 10.00"
              min={0}
              step={0.01}
            />
          </HStack>
          <Text className="text-muted-foreground text-xs">
            {t('providers.costHelp')}
          </Text>
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
                  className="text-muted-foreground hover:text-foreground text-xs font-medium"
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
                className="text-muted-foreground hover:text-foreground text-xs font-medium"
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
        </Stack>
      </FormDialog>

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
    </>
  );
}

const NONE_VALUE = '__none__';

function DefaultModelsSection() {
  const { t } = useT('settings');
  const { config, saveConfig } = useProviderConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const modelDisplayName = useCallback(
    (modelId: string | undefined) => {
      if (!modelId) return '—';
      return (
        config.models.find((m) => m.id === modelId)?.displayName ?? modelId
      );
    },
    [config.models],
  );

  const openDialog = useCallback(() => {
    setForm({ ...config.defaults });
    setDialogOpen(true);
  }, [config.defaults]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const cleaned = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v && v !== NONE_VALUE),
      );
      try {
        await saveConfig({
          defaults: Object.keys(cleaned).length > 0 ? cleaned : undefined,
        });
        setDialogOpen(false);
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [form, saveConfig, t],
  );

  return (
    <>
      <Card contentClassName="p-5">
        <HStack justify="between" align="start" className="border-b pb-4">
          <Stack gap={1}>
            <Text className="text-sm font-semibold">
              {t('providers.defaultModels')}
            </Text>
            <Text className="text-muted-foreground text-[13px]">
              {t('providers.defaultModelsDescription')}
            </Text>
          </Stack>
          <button
            type="button"
            onClick={openDialog}
            className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-[13px] font-medium"
          >
            <Pencil className="size-3.5" />
            {t('providers.editGeneral')}
          </button>
        </HStack>
        <Stack className="divide-y">
          <InfoRow label={t('providers.tagChat')}>
            <Text className="text-sm font-medium">
              {modelDisplayName(config.defaults?.chat)}
            </Text>
          </InfoRow>
          <InfoRow label={t('providers.tagVision')}>
            <Text className="text-sm font-medium">
              {modelDisplayName(config.defaults?.vision)}
            </Text>
          </InfoRow>
          <InfoRow label={t('providers.tagEmbedding')}>
            <Text className="text-sm font-medium">
              {modelDisplayName(config.defaults?.embedding)}
            </Text>
          </InfoRow>
        </Stack>
      </Card>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t('providers.defaultModels')}
        onSubmit={handleSubmit}
        isDirty={
          form.chat !== (config.defaults?.chat ?? NONE_VALUE) ||
          form.vision !== (config.defaults?.vision ?? NONE_VALUE) ||
          form.embedding !== (config.defaults?.embedding ?? NONE_VALUE)
        }
      >
        <Stack gap={4}>
          {(['chat', 'vision', 'embedding'] as const).map((tag) => {
            const modelsWithTag = config.models.filter((m) =>
              (m.tags as readonly string[]).includes(tag),
            );
            return (
              <Select
                key={tag}
                label={
                  tag === 'chat'
                    ? t('providers.tagChat')
                    : tag === 'vision'
                      ? t('providers.tagVision')
                      : t('providers.tagEmbedding')
                }
                options={[
                  { value: NONE_VALUE, label: t('providers.defaultNone') },
                  ...modelsWithTag.map((m) => ({
                    value: m.id,
                    label: m.displayName,
                  })),
                ]}
                value={form[tag] ?? NONE_VALUE}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, [tag]: value }))
                }
              />
            );
          })}
        </Stack>
      </FormDialog>
    </>
  );
}
