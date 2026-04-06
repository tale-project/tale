import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
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
import { Text } from '@/app/components/ui/typography/text';
import {
  useDeleteProvider,
  useSaveProviderSecret,
} from '@/app/features/settings/providers/hooks/mutations';
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
    return (
      <Stack gap={4} className="p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </Stack>
    );
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
      />
    </ProviderConfigProvider>
  );
}

function ProviderDetailContent({
  organizationId,
  providerName,
}: {
  organizationId: string;
  providerName: string;
}) {
  const { t } = useT('settings');
  const navigate = useNavigate();
  const { config } = useProviderConfig();
  const deleteProvider = useDeleteProvider();

  const handleDelete = useCallback(async () => {
    try {
      await deleteProvider.mutateAsync({
        orgSlug: 'default',
        providerName,
      });
      void navigate({
        to: '/dashboard/$id/settings/providers',
        params: { id: organizationId },
      });
    } catch {
      toast({ title: t('providers.deleteFailed'), variant: 'destructive' });
    }
  }, [providerName, organizationId, deleteProvider, navigate, t]);

  return (
    <Stack gap={6} className="p-6">
      <HStack justify="between" align="center">
        <HStack gap={2} align="center">
          <Link
            to="/dashboard/$id/settings/providers"
            params={{ id: organizationId }}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            {t('providers.title')}
          </Link>
          <ChevronRight className="text-muted-foreground size-4" />
          <Text as="span" variant="label">
            {config.displayName}
          </Text>
        </HStack>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          {t('providers.deleteProvider')}
        </Button>
      </HStack>

      <GeneralSection />
      <ApiKeySection providerName={providerName} />
      <DefaultModelsSection />
      <ModelsSection />
    </Stack>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <HStack gap={4} className="py-2.5">
      <Text variant="muted" className="w-28 shrink-0 text-sm">
        {label}
      </Text>
      <div className="min-w-0 flex-1">{children}</div>
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
      <Card contentClassName="px-5 py-2">
        <HStack justify="between" align="center" className="border-b py-2.5">
          <Text variant="muted" className="text-sm">
            {t('providers.general')}
          </Text>
          <Button variant="ghost" size="sm" onClick={openDialog}>
            <Pencil className="mr-1.5 size-3.5" />
            {t('providers.editGeneral')}
          </Button>
        </HStack>
        <Stack className="divide-y">
          <InfoRow label={t('providers.displayName')}>
            <Text className="text-sm">{config.displayName}</Text>
          </InfoRow>
          <InfoRow label={t('providers.description')}>
            <Text className="text-muted-foreground text-sm">
              {config.description || '—'}
            </Text>
          </InfoRow>
          <InfoRow label={t('providers.baseUrl')}>
            <Text className="font-mono text-sm">{config.baseUrl}</Text>
          </InfoRow>
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
            label={t('providers.description')}
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
      <Card contentClassName="px-5 py-2">
        <InfoRow label={t('providers.apiKey')}>
          <HStack gap={2} align="center">
            {hasSecret ? (
              <>
                <Badge variant="green" dot>
                  {t('providers.apiKeyConfigured')}
                </Badge>
                <Text className="text-muted-foreground font-mono text-sm">
                  {maskedKey}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialogOpen(true)}
                >
                  <Pencil className="mr-1.5 size-3.5" />
                  {t('providers.editKey')}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDialogOpen(true)}
              >
                <KeyRound className="mr-1.5 size-3.5" />
                {t('providers.addKey')}
              </Button>
            )}
          </HStack>
        </InfoRow>
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
}

const EMPTY_MODEL_FORM: ModelFormState = {
  id: '',
  displayName: '',
  description: '',
  tags: ['chat'],
  dimensions: '',
};

function ModelsSection() {
  const { t } = useT('settings');
  const { config, saveConfig, isSaving } = useProviderConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<ModelFormState>(EMPTY_MODEL_FORM);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const openAddDialog = useCallback(() => {
    setEditingIndex(null);
    setForm(EMPTY_MODEL_FORM);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback(
    (index: number) => {
      const model = config.models[index];
      if (!model) return;
      setEditingIndex(index);
      setForm({
        id: model.id,
        displayName: model.displayName,
        description: model.description ?? '',
        tags: [...model.tags],
        dimensions: model.dimensions != null ? String(model.dimensions) : '',
      });
      setDialogOpen(true);
    },
    [config.models],
  );

  const handleSubmitModel = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const model = {
        id: form.id,
        displayName: form.displayName,
        description: form.description || undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tags are constrained to checkbox values
        tags: form.tags as Array<'chat' | 'vision' | 'embedding'>,
        dimensions: form.dimensions ? Number(form.dimensions) : undefined,
      };
      const updatedModels =
        editingIndex != null
          ? config.models.map((m, i) => (i === editingIndex ? model : m))
          : [...config.models, model];
      try {
        await saveConfig({ models: updatedModels });
        setDialogOpen(false);
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [form, editingIndex, config.models, saveConfig, t],
  );

  const handleDeleteModel = useCallback(async () => {
    if (deleteIndex == null) return;
    try {
      await saveConfig({
        models: config.models.filter((_, i) => i !== deleteIndex),
      });
      setDeleteIndex(null);
    } catch {
      toast({ title: t('providers.saveFailed'), variant: 'destructive' });
    }
  }, [deleteIndex, config.models, saveConfig, t]);

  return (
    <>
      <Stack gap={3}>
        <HStack justify="between" align="center">
          <Text as="span" variant="label" className="text-base">
            {t('providers.models')}
          </Text>
          <Button variant="secondary" size="sm" onClick={openAddDialog}>
            <Plus className="mr-1.5 size-4" />
            {t('providers.addModel')}
          </Button>
        </HStack>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('providers.modelId')}</TableHead>
              <TableHead>{t('providers.displayName')}</TableHead>
              <TableHead>{t('providers.description')}</TableHead>
              <TableHead>{t('providers.tags')}</TableHead>
              <TableHead className="w-10" />
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
                  <Text className="font-mono text-sm">{model.id}</Text>
                </TableCell>
                <TableCell>
                  <Text className="text-sm">{model.displayName}</Text>
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
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteIndex(index);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>

      {/* Add / Edit model dialog */}
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
        isSubmitting={isSaving}
        isDirty={
          form.id.trim().length > 0 && form.displayName.trim().length > 0
        }
        submitText={
          editingIndex != null ? t('providers.save') : t('providers.addModel')
        }
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
            label={t('providers.description')}
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
        </Stack>
      </FormDialog>

      {/* Delete confirmation */}
      <FormDialog
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
        onSubmit={(e) => {
          e.preventDefault();
          void handleDeleteModel();
        }}
        isSubmitting={isSaving}
        submitText={t('providers.deleteModel')}
      >
        <span />
      </FormDialog>
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
      <Card contentClassName="px-5 py-2">
        <HStack justify="between" align="center" className="border-b py-2.5">
          <Stack gap={1}>
            <Text variant="muted" className="text-sm">
              {t('providers.defaultModels')}
            </Text>
            <Text className="text-muted-foreground text-xs">
              {t('providers.defaultModelsDescription')}
            </Text>
          </Stack>
          <Button variant="ghost" size="sm" onClick={openDialog}>
            <Pencil className="mr-1.5 size-3.5" />
            {t('providers.editGeneral')}
          </Button>
        </HStack>
        <Stack className="divide-y">
          <InfoRow label={t('providers.tagChat')}>
            <Text className="text-sm">
              {modelDisplayName(config.defaults?.chat)}
            </Text>
          </InfoRow>
          <InfoRow label={t('providers.tagVision')}>
            <Text className="text-sm">
              {modelDisplayName(config.defaults?.vision)}
            </Text>
          </InfoRow>
          <InfoRow label={t('providers.tagEmbedding')}>
            <Text className="text-sm">
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
