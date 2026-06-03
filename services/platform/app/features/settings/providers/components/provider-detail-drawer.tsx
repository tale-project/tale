'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  AlertTriangle,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  modelTagLiterals,
  type ProviderJson,
} from '@/lib/shared/schemas/providers';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import {
  useFetchConfiguredProviderModels,
  useSaveProviderSecret,
} from '../hooks/mutations';
import { useHasProviderSecret, useReadProvider } from '../hooks/queries';
import {
  ProviderConfigProvider,
  useProviderConfig,
} from '../hooks/use-provider-config-context';
import {
  dispatchForbiddenDeveloperSettings,
  dispatchOrgAccessError,
  dispatchVersionConflict,
  readConvexErrorData,
} from '../utils/error-dispatch';
import { modelTagLabel } from '../utils/model-tag-label';
import { ProviderDefaultModelsPanel } from './provider-default-models-panel';
import { ProviderEditPanel } from './provider-edit-panel';
import {
  ModelProviderOptionsField,
  ProviderOptionsEditor,
  providerOptionsToJsonString,
} from './provider-options-editor';
import { TestConnectionSheet } from './test-connection-sheet';

interface ProviderDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  providerName: string;
}

/**
 * Stand-in config used to mount the REAL `ProviderConfigProvider` +
 * `ProviderDetailBody` while the live config is still loading. Per the
 * skeleton cardinal rule we never render a separate skeleton tree: the real
 * sections render against this placeholder and their dynamic value leaves mask
 * themselves via `<SkeletonBox>`/`<SkeletonText>` inside `<Skeletonize loading>`.
 * The placeholder strings only set the masked leaves' natural size; they are
 * never visible (the pulse overlay covers them) and never submitted (every
 * editing control is disabled/non-interactive while masked).
 */
const PLACEHOLDER_PROVIDER_CONFIG: ProviderJson = {
  displayName: 'Provider name',
  description: 'Provider description',
  baseUrl: 'https://api.example.com',
  providerOptions: {},
  // A few rows so the masked models list reads like the real one. `tags`
  // carries 'chat' so each row renders (and masks) a capability badge.
  models: Array.from({ length: 4 }, (_, i) => ({
    id: `placeholder-model-${i}`,
    displayName: 'Model name',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 'chat' is a valid modelTagLiterals member; placeholder is never validated/persisted
    tags: ['chat'] as Array<(typeof modelTagLiterals)[number]>,
  })),
};

export function ProviderDetailDrawer({
  open,
  onOpenChange,
  organizationId,
  providerName,
}: ProviderDetailDrawerProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const enabled = open;
  const { data, isLoading } = useReadProvider(organizationId, providerName, {
    enabled,
  });
  const { data: maskedKey, error: secretError } = useHasProviderSecret(
    organizationId,
    providerName,
    { enabled },
  );

  // Narrow the discriminated read result so `config`/`hash`/`maskedModelKeys`
  // are reachable; `undefined` while loading or on the not-found branch.
  const okData = data?.ok ? data : undefined;

  const errorData = readConvexErrorData(secretError);
  const encryptedNoKey = errorData?.code === 'PROVIDER_SECRET_ENCRYPTED_NO_KEY';
  const encryptedNoKeyPath =
    encryptedNoKey && typeof errorData?.path === 'string' ? errorData.path : '';

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.details')}
      size="md"
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('providers.details')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:px-6 sm:py-5">
        {encryptedNoKey && (
          <div className="pb-5">
            <Alert
              variant="destructive"
              icon={AlertTriangle}
              title={t('providers.encryptedNoKeyTitle')}
              description={t('providers.encryptedNoKeyDescription', {
                path: encryptedNoKeyPath,
              })}
            />
          </div>
        )}

        {!isLoading && !data?.ok ? (
          <Stack gap={4}>
            <Text variant="muted">
              {t('providers.providerNotFound', { name: providerName })}
            </Text>
          </Stack>
        ) : (
          // ONE tree, always. While loading we mount the real
          // ProviderConfigProvider + ProviderDetailBody against a placeholder
          // config and let <Skeletonize loading> mask each dynamic value in
          // place — no separate skeleton tree. `key` remounts the provider
          // when the real config arrives so its initial-state seeds correctly.
          <Skeletonize loading={isLoading} label={t('providers.details')}>
            <ProviderConfigProvider
              key={isLoading ? 'loading' : 'loaded'}
              organizationId={organizationId}
              providerName={providerName}
              initialConfig={okData?.config ?? PLACEHOLDER_PROVIDER_CONFIG}
              initialHash={okData?.hash}
            >
              <ProviderDetailBody
                organizationId={organizationId}
                providerName={providerName}
                maskedKey={maskedKey ?? null}
                maskedModelKeys={okData?.maskedModelKeys ?? {}}
                isLoading={isLoading}
              />
            </ProviderConfigProvider>
          </Skeletonize>
        )}
      </div>
    </Sheet>
  );
}

function ProviderDetailBody({
  organizationId,
  providerName,
  maskedKey,
  maskedModelKeys,
  isLoading,
}: {
  organizationId: string;
  providerName: string;
  maskedKey: string | null;
  maskedModelKeys: Record<string, string>;
  isLoading: boolean;
}) {
  return (
    <Stack gap={6}>
      <GeneralSection
        providerName={providerName}
        organizationId={organizationId}
      />
      <ApiKeySection
        organizationId={organizationId}
        providerName={providerName}
        maskedKey={maskedKey}
        isLoading={isLoading}
      />
      <DefaultModelsSection
        organizationId={organizationId}
        providerName={providerName}
      />
      <ProviderOptionsSection />
      <ModelsSection
        organizationId={organizationId}
        providerName={providerName}
        maskedModelKeys={maskedModelKeys}
        isLoading={isLoading}
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
      align="start"
      className={cn('px-4 py-2.5', !isLast && 'border-b')}
    >
      <Text variant="muted" className="w-32 shrink-0 text-sm font-normal">
        {label}
      </Text>
      <div
        className={cn(
          'min-w-0 flex-1 text-sm break-words',
          muted ? 'text-muted-foreground' : 'font-medium',
        )}
      >
        {children}
      </div>
    </HStack>
  );
}

function GeneralSection({
  providerName,
  organizationId,
}: {
  providerName: string;
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <Stack gap={3}>
      <HStack justify="between" align="center" wrap className="gap-y-1">
        <Text
          as="h3"
          className="text-foreground min-w-0 text-base leading-tight font-semibold"
        >
          {t('providers.general')}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setPanelOpen(true)}
        >
          <Pencil className="mr-1 size-3.5" />
          {t('providers.editGeneral')}
        </Button>
      </HStack>
      <Card contentClassName="p-0">
        <InfoRow label={t('providers.displayName')}>
          <SkeletonBox>{config.displayName}</SkeletonBox>
        </InfoRow>
        <InfoRow label={t('providers.description_field')} muted>
          <SkeletonBox>{config.description || '—'}</SkeletonBox>
        </InfoRow>
        <InfoRow label={t('providers.baseUrl')} muted isLast>
          <SkeletonBox>{config.baseUrl}</SkeletonBox>
        </InfoRow>
      </Card>

      <ProviderEditPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        providerName={providerName}
        organizationId={organizationId}
      />
    </Stack>
  );
}

function DefaultModelsSection({
  organizationId,
  providerName,
}: {
  organizationId: string;
  providerName: string;
}) {
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
      <Stack gap={3}>
        <HStack justify="between" align="start" wrap className="gap-y-1">
          <Stack gap={1} className="min-w-0">
            <Text
              as="h3"
              className="text-foreground text-base leading-tight font-semibold"
            >
              {t('providers.defaultModels')}
            </Text>
            <Text className="text-muted-foreground text-sm">
              {t('providers.defaultModelsDescription')}
            </Text>
          </Stack>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setPanelOpen(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            {t('providers.editDefaults')}
          </Button>
        </HStack>
        <Card contentClassName="p-0">
          <InfoRow label={t('providers.tagChat')}>
            <SkeletonBox>{modelDisplayName(config.defaults?.chat)}</SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagVision')}>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.vision)}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagEmbedding')}>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.embedding)}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagImageGeneration')}>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.['image-generation'])}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagTranscription')} isLast>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.transcription)}
            </SkeletonBox>
          </InfoRow>
        </Card>
      </Stack>

      <ProviderDefaultModelsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        organizationId={organizationId}
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
        guideLabel: t('providers.providerOptions.guideLabel'),
        notConfigured: t('providers.providerOptions.notConfigured'),
        editLabel: t('providers.editGeneral'),
        saveLabel: t('providers.providerOptions.save'),
        cancelLabel: tCommon('actions.cancel'),
        saveSuccess: t('providers.providerOptions.saveSuccess'),
        saveError: t('providers.providerOptions.saveError'),
        exampleLabel: t('providers.providerOptions.exampleLabel'),
        discardConfirmTitle: t('providers.providerOptions.discardConfirmTitle'),
        discardConfirmDescription: t(
          'providers.providerOptions.discardConfirmDescription',
        ),
        discardConfirmAction: t(
          'providers.providerOptions.discardConfirmAction',
        ),
        discardConfirmKeep: t('providers.providerOptions.discardConfirmKeep'),
        objectRequiredError: t('providers.providerOptions.objectRequiredError'),
      }}
    />
  );
}

function ApiKeySection({
  organizationId,
  providerName,
  maskedKey,
  isLoading,
}: {
  organizationId: string;
  providerName: string;
  maskedKey: string | null;
  isLoading: boolean;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  // While loading we don't yet know whether a key exists; render the
  // "configured" chrome with a placeholder value so the masked row has its
  // natural size (the pulse covers the placeholder text).
  const hasSecret = isLoading || maskedKey != null;
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
      if (!apiKey.trim() || !organizationId) return;
      setSaving(true);
      try {
        await saveSecret.mutateAsync({
          organizationId,
          providerName,
          apiKey: apiKey.trim(),
          force: force || undefined,
        });
        setApiKey('');
        setDialogOpen(false);
        setOverwritePrompt(null);
        toast({
          title: t('providers.apiKeyUpdated'),
          variant: 'success',
        });
      } catch (err) {
        const data = readConvexErrorData(err);
        if (
          data?.code === 'PROVIDER_SECRET_REFUSED_OVERWRITE' &&
          (data.kind === 'encrypted_no_key' ||
            data.kind === 'undecryptable_existing')
        ) {
          setOverwritePrompt({
            kind: data.kind,
            path: typeof data.path === 'string' ? data.path : '',
            reason: typeof data.reason === 'string' ? data.reason : undefined,
          });
        } else {
          setOverwritePrompt(null);
          if (
            !dispatchOrgAccessError(err, tAccessDenied) &&
            !dispatchForbiddenDeveloperSettings(err, t)
          ) {
            toast({
              title: t('providers.secretSaveFailed'),
              variant: 'destructive',
            });
          }
        }
      } finally {
        setSaving(false);
      }
    },
    [apiKey, organizationId, providerName, saveSecret, t, tAccessDenied],
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
      <Stack gap={3}>
        <HStack justify="between" align="center" wrap className="gap-y-1">
          <Text
            as="h3"
            className="text-foreground min-w-0 text-base leading-tight font-semibold"
          >
            {t('providers.apiKey')}
          </Text>
          <HStack
            gap={1}
            align="center"
            wrap
            className="ml-auto justify-end gap-y-1"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTestDialogOpen(true)}
            >
              <Zap className="mr-1 size-3.5" />
              {t('providers.testConnection')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              <Pencil className="mr-1 size-3.5" />
              {hasSecret ? t('providers.editKey') : t('providers.addKey')}
            </Button>
          </HStack>
        </HStack>
        <Card contentClassName="p-0">
          {hasSecret ? (
            <HStack gap={4} align="center" className="flex-wrap px-4 py-2.5">
              <SkeletonBox>
                <Badge variant="green" dot>
                  {t('providers.apiKeyConfigured')}
                </Badge>
              </SkeletonBox>
              <Text className="text-muted-foreground font-mono text-sm">
                <SkeletonBox>{maskedKey ?? 'sk-••••••••••••'}</SkeletonBox>
              </Text>
            </HStack>
          ) : (
            <HStack gap={3} align="center" className="px-4 py-2.5">
              <Badge variant="outline">
                {t('providers.apiKeyNotConfigured')}
              </Badge>
            </HStack>
          )}
        </Card>
      </Stack>

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
        organizationId={organizationId}
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

  // Fetched-but-not-yet-configured model IDs from the provider's /models
  // endpoint. Configured models live in config.models — this list holds the
  // delta the user can opt into via checkbox.
  const [fetchedModelIds, setFetchedModelIds] = useState<string[]>([]);
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
          displayName: modelId,
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
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [config.models, saveConfig, t, tAccessDenied],
  );

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
          if (isRecord(parsed)) {
            if (Object.keys(parsed).length > 0) {
              providerOptions = parsed;
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
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tags are constrained to modelTagLiterals values
        tags: form.tags as Array<(typeof modelTagLiterals)[number]>,
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
              size="sm"
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openAddDialog}
            >
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
                          {model?.displayName ?? row.id}
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
                <HStack gap={4} align="center" className="flex-wrap">
                  {modelTagLiterals.map((tag) => (
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
                  step={0.01}
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
                  step={0.01}
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
