import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Skeleton } from '@tale/ui/skeleton';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Loader2, Pencil, Trash2, X, Zap } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Card } from '@/app/components/ui/layout/card';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { ProviderEditPanel } from '@/app/features/settings/providers/components/provider-edit-panel';
import { TestConnectionSheet } from '@/app/features/settings/providers/components/test-connection-sheet';
import { useSaveProviderSecret } from '@/app/features/settings/providers/hooks/mutations';
import {
  useHasProviderSecret,
  useReadProvider,
} from '@/app/features/settings/providers/hooks/queries';
import {
  ProviderConfigProvider,
  useProviderConfig,
} from '@/app/features/settings/providers/hooks/use-provider-config-context';
import { modelTagLabel } from '@/app/features/settings/providers/utils/model-tag-label';
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
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);
  const orgSlug = organization?.slug ?? '';
  const { data, isLoading } = useReadProvider(orgSlug, providerName);

  if (isOrgLoading || isLoading) {
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
        orgSlug={orgSlug}
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
  orgSlug,
  providerName,
  maskedModelKeys,
}: {
  organizationId: string;
  orgSlug: string;
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

      <GeneralSection providerName={providerName} />
      <ApiKeySection orgSlug={orgSlug} providerName={providerName} />
      <ModelsSection
        orgSlug={orgSlug}
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

function GeneralSection({ providerName }: { providerName: string }) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();
  const [panelOpen, setPanelOpen] = useState(false);

  const modelDisplayName = useCallback(
    (modelId: string | undefined) => {
      if (!modelId) return '—';
      return (
        config.models.find((m) => m.id === modelId)?.displayName ?? modelId
      );
    },
    [config.models],
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
            onClick={() => setPanelOpen(true)}
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
            onClick={() => setPanelOpen(true)}
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

      <ProviderEditPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        providerName={providerName}
      />
    </>
  );
}

function ApiKeySection({
  orgSlug,
  providerName,
}: {
  orgSlug: string;
  providerName: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { data: maskedKey } = useHasProviderSecret(orgSlug, providerName);
  const hasSecret = maskedKey != null;
  const saveSecret = useSaveProviderSecret();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const handleSaveKey = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!apiKey.trim() || !orgSlug) return;
      setSaving(true);
      try {
        await saveSecret.mutateAsync({
          orgSlug,
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
    [apiKey, orgSlug, providerName, saveSecret, t],
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
              <button
                type="button"
                onClick={() => setTestDialogOpen(true)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[13px] font-medium"
              >
                <Zap className="size-3.5" />
                {t('providers.testConnection')}
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

      <Sheet
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setApiKey('');
        }}
        title={
          hasSecret ? t('providers.replaceApiKey') : t('providers.addApiKey')
        }
        size="md"
        hideClose
        className="flex flex-col gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => apiKeyInputRef.current?.focus());
        }}
      >
        <HStack
          justify="between"
          align="center"
          className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
        >
          <Text variant="label" className="text-base font-semibold">
            {hasSecret
              ? t('providers.replaceApiKey')
              : t('providers.addApiKey')}
          </Text>
          <IconButton
            icon={X}
            aria-label={tCommon('aria.close')}
            variant="ghost"
            onClick={() => {
              setDialogOpen(false);
              setApiKey('');
            }}
          />
        </HStack>

        <form onSubmit={handleSaveKey} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
            <Stack gap={4}>
              {hasSecret && (
                <Text className="text-muted-foreground text-sm">
                  {t('providers.replaceApiKeyDescription', {
                    maskedKey: maskedKey ?? '',
                  })}
                </Text>
              )}
              <Input
                ref={apiKeyInputRef}
                type="password"
                label={t('providers.apiKey')}
                placeholder={t('providers.apiKeyEnter')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Stack>
          </div>

          <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
            <HStack justify="end" align="center">
              <Button
                type="submit"
                disabled={saving || apiKey.trim().length === 0}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('providers.saving')}
                  </>
                ) : (
                  t('providers.saveKey')
                )}
              </Button>
            </HStack>
          </div>
        </form>
      </Sheet>

      <TestConnectionSheet
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        orgSlug={orgSlug}
        providerName={providerName}
      />
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
  imageCostPerImage: string;
  imageGenerationMode: '' | 'images-api' | 'chat-multimodal';
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
  imageCostPerImage: '',
  imageGenerationMode: '',
  baseUrl: '',
  apiKey: '',
};

function ModelsSection({
  orgSlug,
  providerName,
  maskedModelKeys,
}: {
  orgSlug: string;
  providerName: string;
  maskedModelKeys: Record<string, string>;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
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
  const modelIdInputRef = useRef<HTMLInputElement>(null);

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
      const hasTokenCost =
        !!form.inputCostPerMillion || !!form.outputCostPerMillion;
      const hasImageCost = !!form.imageCostPerImage;
      const cost =
        hasTokenCost || hasImageCost
          ? {
              ...(hasTokenCost
                ? {
                    inputCentsPerMillion: form.inputCostPerMillion
                      ? Math.round(Number(form.inputCostPerMillion) * 100)
                      : 0,
                    outputCentsPerMillion: form.outputCostPerMillion
                      ? Math.round(Number(form.outputCostPerMillion) * 100)
                      : 0,
                  }
                : {}),
              ...(hasImageCost
                ? {
                    imageCentsPerImage: Math.round(
                      Number(form.imageCostPerImage) * 100,
                    ),
                  }
                : {}),
            }
          : undefined;
      const isImageGen = form.tags.includes('image-generation');
      const model = {
        id: form.id,
        displayName: form.displayName,
        description: form.description || undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tags are constrained to checkbox values
        tags: form.tags as Array<
          'chat' | 'vision' | 'embedding' | 'image-generation' | 'image-edit'
        >,
        dimensions: form.dimensions ? Number(form.dimensions) : undefined,
        imageGenerationMode:
          isImageGen && form.imageGenerationMode
            ? form.imageGenerationMode
            : undefined,
        baseUrl: form.baseUrl.trim() || undefined,
        cost,
      };
      const updatedModels =
        editingIndex != null
          ? config.models.map((m, i) => (i === editingIndex ? model : m))
          : [...config.models, model];
      try {
        await saveConfig({ models: updatedModels });
        if ((form.apiKey.trim() || modelKeyAction === 'remove') && orgSlug) {
          setSavingSecret(true);
          try {
            await saveSecret.mutateAsync({
              orgSlug,
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
      orgSlug,
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
      if (deletedModel && orgSlug) {
        await saveSecret.mutateAsync({
          orgSlug,
          providerName,
          modelKeys: { [deletedModel.id]: '' },
        });
      }
      setDeleteIndex(null);
    } catch {
      toast({ title: t('providers.saveFailed'), variant: 'destructive' });
    }
  }, [
    deleteIndex,
    config.models,
    saveConfig,
    saveSecret,
    orgSlug,
    providerName,
    t,
  ]);

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
                          {modelTagLabel(tag, t)}
                        </Badge>
                      ))}
                    </HStack>
                  </TableCell>
                  <TableCell className="text-right">
                    {model.cost?.imageCentsPerImage != null ? (
                      <Text className="text-muted-foreground text-xs">
                        ${(model.cost.imageCentsPerImage / 100).toFixed(2)}/img
                      </Text>
                    ) : model.cost?.inputCentsPerMillion != null ||
                      model.cost?.outputCentsPerMillion != null ? (
                      <Text className="text-muted-foreground text-xs">
                        $
                        {((model.cost.inputCentsPerMillion ?? 0) / 100).toFixed(
                          2,
                        )}{' '}
                        / $
                        {(
                          (model.cost.outputCentsPerMillion ?? 0) / 100
                        ).toFixed(2)}
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
          <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
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
              <HStack gap={4} align="center" className="flex-wrap">
                {(
                  [
                    'chat',
                    'vision',
                    'embedding',
                    'image-generation',
                    'image-edit',
                  ] as const
                ).map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-1.5 text-sm"
                  >
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
                    {modelTagLabel(tag, t)}
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
              {form.tags.includes('image-generation') && (
                <Stack gap={3}>
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      {t('providers.imageGenerationMode')}
                    </label>
                    <select
                      className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                      value={form.imageGenerationMode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- select option values are constrained to the empty string or one of the two enum variants
                          imageGenerationMode: e.target
                            .value as ModelFormState['imageGenerationMode'],
                        }))
                      }
                    >
                      <option value="">
                        images-api ({t('providers.default')})
                      </option>
                      <option value="images-api">images-api</option>
                      <option value="chat-multimodal">chat-multimodal</option>
                    </select>
                    <Text className="text-muted-foreground mt-1 text-xs">
                      {t('providers.imageGenerationModeHelp')}
                    </Text>
                  </div>
                </Stack>
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
              {form.tags.includes('image-generation') && (
                <Input
                  label="Cost per image (USD)"
                  type="number"
                  value={form.imageCostPerImage}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      imageCostPerImage: e.target.value,
                    }))
                  }
                  placeholder="e.g., 0.06"
                  min={0}
                  step={0.01}
                />
              )}
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
          </div>

          <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
            <HStack justify="end" align="center">
              <Button
                type="submit"
                disabled={
                  isSaving ||
                  savingSecret ||
                  !(
                    form.id.trim().length > 0 &&
                    form.displayName.trim().length > 0 &&
                    (editingIndex == null ||
                      modelKeyAction === 'remove' ||
                      JSON.stringify(form) !== JSON.stringify(initialForm))
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
    </>
  );
}
