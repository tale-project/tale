import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Skeleton } from '@tale/ui/skeleton';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ChevronRight,
  Layers,
  Loader2,
  Pencil,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

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
import { Alert } from '@/app/components/ui/feedback/alert';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Card } from '@/app/components/ui/layout/card';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { ProviderDefaultModelsPanel } from '@/app/features/settings/providers/components/provider-default-models-panel';
import { ProviderEditPanel } from '@/app/features/settings/providers/components/provider-edit-panel';
import {
  ModelProviderOptionsField,
  ProviderOptionsEditor,
  providerOptionsToJsonString,
} from '@/app/features/settings/providers/components/provider-options-editor';
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
import { cn } from '@/lib/utils/cn';

export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  component: ProviderDetailRoute,
});

/**
 * Read structured `data` off a Convex action error without `instanceof
 * ConvexError`. Vite HMR / chunk splitting can produce multiple copies of the
 * `ConvexError` class — the prototype-chain check then returns false even
 * though the error IS a ConvexError. The UI only needs the structural shape
 * (`{ data: { code, ... } }`), so check that directly.
 */
function readConvexErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = (err as { data: unknown }).data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- data is a runtime-checked object; downstream reads narrow per-field
  return data as Record<string, unknown>;
}

function ProviderDetailRoute() {
  const { t } = useT('settings');
  const { id: organizationId, providerName } = Route.useParams();
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);
  const orgSlug = organization?.slug ?? '';
  // Fire readProvider and hasProviderSecret in parallel as soon as orgSlug
  // is known. Keeping hasProviderSecret at route level (instead of inside
  // ApiKeySection) breaks a 3-step request waterfall — the encrypted-no-key
  // banner appears in roughly max(read, has) instead of read+has, and shows
  // even while the body skeleton is still rendering.
  const enabled = !!orgSlug;
  const { data, isLoading } = useReadProvider(orgSlug, providerName, {
    enabled,
  });
  const { data: maskedKey, error: secretError } = useHasProviderSecret(
    orgSlug,
    providerName,
    { enabled },
  );

  // Structural check (not `instanceof ConvexError`): Vite HMR / chunk
  // splitting can produce multiple copies of the ConvexError class so the
  // prototype-chain check fails even when the error IS one.
  const errorData = readConvexErrorData(secretError);
  const encryptedNoKey = errorData?.code === 'PROVIDER_SECRET_ENCRYPTED_NO_KEY';
  const encryptedNoKeyPath =
    encryptedNoKey && typeof errorData?.path === 'string' ? errorData.path : '';

  const banner = encryptedNoKey ? (
    <div className="px-4 pt-6">
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('providers.encryptedNoKeyTitle')}
        description={t('providers.encryptedNoKeyDescription', {
          path: encryptedNoKeyPath,
        })}
      />
    </div>
  ) : null;

  if (isOrgLoading || isLoading) {
    return (
      <>
        {banner}
        <ProviderDetailSkeleton />
      </>
    );
  }

  if (!data?.ok) {
    return (
      <>
        {banner}
        <Stack gap={4} className="p-6">
          <Text variant="muted">
            {t('providers.providerNotFound', { name: providerName })}
          </Text>
          <Link
            to="/dashboard/$id/settings/providers"
            params={{ id: organizationId }}
          >
            <Button variant="secondary">
              {t('providers.backToProviders')}
            </Button>
          </Link>
        </Stack>
      </>
    );
  }

  return (
    <ProviderConfigProvider
      providerName={providerName}
      initialConfig={data.config}
    >
      {banner}
      <ProviderDetailContent
        organizationId={organizationId}
        orgSlug={orgSlug}
        providerName={providerName}
        maskedKey={maskedKey ?? null}
        maskedModelKeys={data.maskedModelKeys ?? {}}
      />
    </ProviderConfigProvider>
  );
}

function ProviderDetailSkeleton() {
  return (
    <Stack gap={6} className="px-2">
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
  maskedKey,
  maskedModelKeys,
}: {
  organizationId: string;
  orgSlug: string;
  providerName: string;
  maskedKey: string | null;
  maskedModelKeys: Record<string, string>;
}) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();

  return (
    <Stack gap={6} className="px-2">
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
      <ApiKeySection
        orgSlug={orgSlug}
        providerName={providerName}
        maskedKey={maskedKey}
      />
      <DefaultModelsSection providerName={providerName} />
      <ProviderOptionsSection />
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
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  isLast?: boolean;
}) {
  return (
    <HStack
      gap={4}
      align="center"
      className={cn('px-5 py-3.5', !isLast && 'border-b')}
    >
      <Text variant="muted" className="w-36 shrink-0 text-sm font-normal">
        {label}
      </Text>
      <div
        className={cn(
          'min-w-0 flex-1 text-sm',
          muted ? 'text-muted-foreground' : 'font-medium',
        )}
      >
        {children}
      </div>
    </HStack>
  );
}

function SectionHeader({
  title,
  description,
  onEdit,
  editLabel,
}: {
  title: string;
  description?: string;
  onEdit: () => void;
  editLabel: string;
}) {
  return (
    <HStack
      justify="between"
      align={description ? 'start' : 'center'}
      className="border-b px-5 py-4"
    >
      <Stack gap={1}>
        <Text className="text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </Text>
        {description && (
          <Text className="text-muted-foreground text-[13px]">
            {description}
          </Text>
        )}
      </Stack>
      <button
        type="button"
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-[13px] font-medium"
      >
        <Pencil className="size-3.5" />
        {editLabel}
      </button>
    </HStack>
  );
}

function GeneralSection({ providerName }: { providerName: string }) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <Card contentClassName="p-0">
        <SectionHeader
          title={t('providers.general')}
          onEdit={() => setPanelOpen(true)}
          editLabel={t('providers.editGeneral')}
        />
        <InfoRow label={t('providers.displayName')}>
          {config.displayName}
        </InfoRow>
        <InfoRow label={t('providers.description_field')} muted>
          {config.description || '—'}
        </InfoRow>
        <InfoRow label={t('providers.baseUrl')} muted isLast>
          {config.baseUrl}
        </InfoRow>
      </Card>

      <ProviderEditPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        providerName={providerName}
      />
    </>
  );
}

function DefaultModelsSection({ providerName }: { providerName: string }) {
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
      <Card contentClassName="p-0">
        <SectionHeader
          title={t('providers.defaultModels')}
          description={t('providers.defaultModelsDescription')}
          onEdit={() => setPanelOpen(true)}
          editLabel={t('providers.editDefaults')}
        />
        <InfoRow label={t('providers.tagChat')}>
          {modelDisplayName(config.defaults?.chat)}
        </InfoRow>
        <InfoRow label={t('providers.tagVision')}>
          {modelDisplayName(config.defaults?.vision)}
        </InfoRow>
        <InfoRow label={t('providers.tagEmbedding')} isLast>
          {modelDisplayName(config.defaults?.embedding)}
        </InfoRow>
      </Card>

      <ProviderDefaultModelsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        providerName={providerName}
      />
    </>
  );
}

function ProviderOptionsSection() {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { config, isSaving, saveConfig } = useProviderConfig();

  return (
    <ProviderOptionsEditor
      initialJson={providerOptionsToJsonString(config.providerOptions)}
      isSaving={isSaving}
      onSave={async (parsed) => {
        await saveConfig({ providerOptions: parsed });
      }}
      copy={{
        title: t('providers.providerOptions.providerLevelTitle'),
        description: t('providers.providerOptions.providerLevelDescription'),
        notConfigured: t('providers.providerOptions.notConfigured'),
        editLabel: t('providers.editGeneral'),
        saveLabel: t('providers.providerOptions.save'),
        cancelLabel: tCommon('actions.cancel'),
        saveSuccess: t('providers.providerOptions.saveSuccess'),
        saveError: t('providers.providerOptions.saveError'),
      }}
    />
  );
}

function ApiKeySection({
  orgSlug,
  providerName,
  maskedKey,
}: {
  orgSlug: string;
  providerName: string;
  maskedKey: string | null;
}) {
  const { t } = useT('settings');
  const hasSecret = maskedKey != null;
  const saveSecret = useSaveProviderSecret();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [overwritePrompt, setOverwritePrompt] = useState<{
    kind: 'encrypted_no_key' | 'undecryptable_existing';
    path: string;
    reason?: string;
  } | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const performSave = useCallback(
    async (force: boolean) => {
      if (!apiKey.trim() || !orgSlug) return;
      setSaving(true);
      try {
        await saveSecret.mutateAsync({
          orgSlug,
          providerName,
          apiKey: apiKey.trim(),
          force: force || undefined,
        });
        setApiKey('');
        setDialogOpen(false);
        setOverwritePrompt(null);
      } catch (err) {
        const data = readConvexErrorData(err);
        if (
          data?.code === 'PROVIDER_SECRET_REFUSED_OVERWRITE' &&
          (data.kind === 'encrypted_no_key' ||
            data.kind === 'undecryptable_existing')
        ) {
          // Server refused the overwrite — surface the confirm dialog so the
          // operator can opt into discarding the unreadable existing file.
          setOverwritePrompt({
            kind: data.kind,
            path: typeof data.path === 'string' ? data.path : '',
            reason: typeof data.reason === 'string' ? data.reason : undefined,
          });
        } else {
          // Non-overwrite failure during retry: clear the stuck dialog before
          // toasting so the destructive ConfirmDialog doesn't sit open behind
          // a toast.
          setOverwritePrompt(null);
          toast({
            title: t('providers.secretSaveFailed'),
            variant: 'destructive',
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [apiKey, orgSlug, providerName, saveSecret, t],
  );

  const handleSaveKey = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await performSave(false);
    },
    [performSave],
  );

  const handleConfirmOverwrite = useCallback(() => {
    void performSave(true);
  }, [performSave]);

  return (
    <>
      <Card contentClassName="p-0">
        <SectionHeader
          title={t('providers.apiKey')}
          onEdit={() => setDialogOpen(true)}
          editLabel={hasSecret ? t('providers.editKey') : t('providers.addKey')}
        />
        {hasSecret ? (
          <HStack gap={4} align="center" className="flex-wrap px-5 py-3.5">
            <Badge variant="green" dot>
              {t('providers.apiKeyConfigured')}
            </Badge>
            <Text className="text-muted-foreground font-mono text-sm">
              {maskedKey}
            </Text>
            <button
              type="button"
              onClick={() => setTestDialogOpen(true)}
              className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1.5 text-[13px] font-medium"
            >
              <Zap className="size-3.5" />
              {t('providers.testConnection')}
            </button>
          </HStack>
        ) : (
          <HStack gap={3} align="center" className="px-5 py-3.5">
            <Badge variant="outline">
              {t('providers.apiKeyNotConfigured')}
            </Badge>
          </HStack>
        )}
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
        onSubmit={handleSaveKey}
        isSubmitting={saving}
        isValid={apiKey.trim().length > 0}
        submitText={t('providers.saveKey')}
        submittingText={t('providers.saving')}
      >
        {hasSecret && (
          <Text className="text-muted-foreground text-sm">
            {t('providers.replaceApiKeyDescription', {
              maskedKey: maskedKey ?? '',
            })}
          </Text>
        )}
        <Input
          ref={apiKeyInputRef}
          autoFocus
          type="password"
          label={t('providers.apiKey')}
          placeholder={t('providers.apiKeyEnter')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </FormDialog>

      <TestConnectionSheet
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        orgSlug={orgSlug}
        providerName={providerName}
      />

      <ConfirmDialog
        open={overwritePrompt != null}
        onOpenChange={(open) => {
          if (!open) setOverwritePrompt(null);
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
        isLoading={saving}
        onConfirm={handleConfirmOverwrite}
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
  /**
   * Free-form JSON for `providerOptions` — empty string means absent. Stored
   * as a string here so the JsonInput's textarea state and our form state
   * stay aligned without a separate parse step until submit.
   */
  providerOptionsJson: string;
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
  providerOptionsJson: '',
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
  const [searchQuery, setSearchQuery] = useState('');
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
        providerOptionsJson: providerOptionsToJsonString(model.providerOptions),
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
      let providerOptions: Record<string, unknown> | undefined;
      const trimmedProviderOptions = form.providerOptionsJson.trim();
      if (trimmedProviderOptions) {
        try {
          const parsed: unknown = JSON.parse(trimmedProviderOptions);
          if (
            parsed != null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)
          ) {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime checks above narrow `parsed` to a non-null, non-array plain object; TS can't track the narrowing across JSON.parse
            const obj = parsed as Record<string, unknown>;
            if (Object.keys(obj).length > 0) {
              providerOptions = obj;
            }
          }
        } catch (parseErr) {
          toast({
            title: t('providers.providerOptions.invalidJson'),
            description:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
            variant: 'destructive',
          });
          return;
        }
      }
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
        providerOptions,
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

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return config.models.map((model, index) => ({ model, index }));
    }
    return config.models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => {
        const haystack = [
          model.id,
          model.displayName,
          model.description ?? '',
          ...model.tags.map((tag) => modelTagLabel(tag, t)),
          ...model.tags,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
  }, [config.models, searchQuery, t]);

  return (
    <>
      <Stack gap={3} className="mb-8">
        <HStack justify="between" align="center">
          <Text className="text-[15px] font-semibold tracking-[-0.01em]">
            {t('providers.models')}
          </Text>
          <HStack gap={2} align="center">
            <SearchInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('providers.searchModels')}
            />
            <Button onClick={openAddDialog}>
              {t('providers.addModelShort')}
            </Button>
          </HStack>
        </HStack>

        <div className="overflow-hidden rounded-xl border">
          {config.models.length === 0 ? (
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
          ) : (
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
                    {t('providers.costPerMillionTokens')}
                  </TableHead>
                  <TableHead className="w-11" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModels.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={Search}
                        title={t('providers.modelsEmpty.searchTitle')}
                        description={t(
                          'providers.modelsEmpty.searchDescription',
                        )}
                      />
                    </TableCell>
                  </TableRow>
                )}
                {filteredModels.map(({ model, index }) => (
                  <TableRow
                    key={index}
                    className="cursor-pointer"
                    onClick={() => openEditDialog(index)}
                  >
                    <TableCell>
                      <HStack gap={2} align="center">
                        <Text className="font-mono text-[13px]">
                          {model.id}
                        </Text>
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
                        {model.providerOptions &&
                          Object.keys(model.providerOptions).length > 0 && (
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              title={JSON.stringify(model.providerOptions)}
                            >
                              {t('providers.providerOptions.indicator')}
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
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-xs"
                          >
                            {modelTagLabel(tag, t)}
                          </Badge>
                        ))}
                      </HStack>
                    </TableCell>
                    <TableCell className="text-right">
                      {model.cost?.imageCentsPerImage != null ? (
                        <Text className="text-muted-foreground text-xs">
                          ${(model.cost.imageCentsPerImage / 100).toFixed(2)}
                          /img
                        </Text>
                      ) : model.cost?.inputCentsPerMillion != null ||
                        model.cost?.outputCentsPerMillion != null ? (
                        <Text className="text-muted-foreground text-xs">
                          $
                          {(
                            (model.cost.inputCentsPerMillion ?? 0) / 100
                          ).toFixed(2)}{' '}
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
          )}
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
                  helpText: t('providers.providerOptions.modelLevelHelp'),
                }}
              />
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
