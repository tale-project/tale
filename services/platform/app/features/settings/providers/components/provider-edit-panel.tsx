'use client';

import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { Separator } from '@/app/components/ui/layout/separator';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteProvider,
  useSaveProvider,
  useSaveProviderSecret,
} from '../hooks/mutations';
import { useHasProviderSecret, useReadProvider } from '../hooks/queries';

interface ProviderEditPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  organizationId: string;
}

interface ModelFormData {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
  dimensions: string;
}

const TAG_VALUES = ['chat', 'vision', 'embedding'] as const;

function emptyModel(): ModelFormData {
  return {
    id: '',
    displayName: '',
    description: '',
    tags: ['chat'],
    dimensions: '',
  };
}

export function ProviderEditPanel({
  open,
  onOpenChange,
  providerName,
  organizationId: _organizationId,
}: ProviderEditPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const { data: readResult, isLoading } = useReadProvider(
    'default',
    providerName,
  );
  const { data: maskedKey } = useHasProviderSecret('default', providerName);
  const hasSecret = maskedKey != null;
  const { mutateAsync: saveProvider, isPending: isSaving } = useSaveProvider();
  const { mutateAsync: deleteProvider, isPending: isDeleting } =
    useDeleteProvider();
  const { mutateAsync: saveSecret, isPending: isSavingSecret } =
    useSaveProviderSecret();

  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<ModelFormData[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Populate form when provider data loads
  useEffect(() => {
    if (readResult && 'config' in readResult && readResult.ok) {
      const config = readResult.config as {
        displayName: string;
        description?: string;
        baseUrl: string;
        defaults?: Record<string, string>;
        models: Array<{
          id: string;
          displayName: string;
          description?: string;
          tags: string[];
          dimensions?: number;
        }>;
      };
      setDisplayName(config.displayName);
      setDescription(config.description ?? '');
      setBaseUrl(config.baseUrl);
      setDefaults(config.defaults ?? {});
      setModels(
        config.models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          description: m.description ?? '',
          tags: [...m.tags],
          dimensions: m.dimensions != null ? String(m.dimensions) : '',
        })),
      );
      setApiKey('');
    }
  }, [readResult]);

  const handleSave = useCallback(async () => {
    // Validate before saving
    if (!displayName.trim()) {
      toast({
        title: t('providers.displayNameRequired'),
        variant: 'destructive',
      });
      return;
    }
    try {
      const _url = new URL(baseUrl);
      void _url;
    } catch {
      toast({ title: t('providers.invalidBaseUrl'), variant: 'destructive' });
      return;
    }
    if (models.some((m) => !m.id.trim())) {
      toast({ title: t('providers.modelIdRequired'), variant: 'destructive' });
      return;
    }
    try {
      const config = {
        displayName,
        description: description || undefined,
        baseUrl,
        defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
        models: models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          description: m.description || undefined,
          tags: m.tags,
          dimensions:
            m.tags.includes('embedding') && m.dimensions
              ? Number(m.dimensions)
              : undefined,
        })),
      };
      await saveProvider({
        orgSlug: 'default',
        providerName,
        config,
      });
      toast({ title: t('providers.saved'), variant: 'success' });
    } catch (error) {
      console.error(error);
      toast({ title: t('providers.saveFailed'), variant: 'destructive' });
    }
  }, [
    displayName,
    description,
    baseUrl,
    defaults,
    models,
    saveProvider,
    providerName,
    t,
  ]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteProvider({ orgSlug: 'default', providerName });
      toast({ title: t('providers.deleted'), variant: 'success' });
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({ title: t('providers.deleteFailed'), variant: 'destructive' });
    }
  }, [deleteProvider, providerName, t, onOpenChange]);

  const handleSaveSecret = useCallback(async () => {
    if (!apiKey.trim()) return;
    try {
      await saveSecret({ orgSlug: 'default', providerName, apiKey });
      toast({ title: t('providers.secretSaved'), variant: 'success' });
      setApiKey('');
    } catch (error) {
      console.error(error);
      toast({
        title: t('providers.secretSaveFailed'),
        variant: 'destructive',
      });
    }
  }, [apiKey, saveSecret, providerName, t]);

  const updateModel = (index: number, updates: Partial<ModelFormData>) => {
    setModels((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...updates } : m)),
    );
  };

  const removeModel = (index: number) => {
    setModels((prev) => prev.filter((_, i) => i !== index));
  };

  const addModel = () => {
    setModels((prev) => [...prev, emptyModel()]);
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={t('providers.editProvider')}
        side="right"
        size="md"
        className="overflow-y-auto"
      >
        {isLoading ? (
          <Stack gap={4} className="pt-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </Stack>
        ) : (
          <Stack gap={6} className="pt-2 pb-24">
            {/* General section */}
            <Stack gap={4}>
              <SectionHeader title={t('providers.general')} as="h3" size="sm" />
              <Input
                label={t('providers.displayName')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('providers.displayNamePlaceholder')}
              />
              <Textarea
                label={t('providers.description_field')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('providers.descriptionPlaceholder')}
                rows={2}
              />
              <Input
                label={t('providers.baseUrl')}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('providers.baseUrlPlaceholder')}
              />
            </Stack>

            <Separator />

            {/* API Key section */}
            <Stack gap={3}>
              <HStack gap={2} justify="between" align="center">
                <SectionHeader
                  title={t('providers.apiKey')}
                  as="h3"
                  size="sm"
                />
                <Badge variant={hasSecret ? 'green' : 'orange'} dot>
                  {hasSecret
                    ? t('providers.apiKeyConfigured')
                    : t('providers.apiKeyNotConfigured')}
                </Badge>
              </HStack>
              {maskedKey && (
                <HStack gap={2} align="center">
                  <KeyRound className="text-muted-foreground size-4" />
                  <Text className="text-muted-foreground font-mono text-sm">
                    {maskedKey}
                  </Text>
                </HStack>
              )}
              <HStack gap={2} align="end">
                <Input
                  type={apiKey ? 'password' : 'text'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    hasSecret
                      ? t('providers.apiKeyReplacePlaceholder', {
                          maskedKey: maskedKey ?? '',
                        })
                      : t('providers.apiKeyPlaceholder')
                  }
                  wrapperClassName="flex-1"
                />
                <Button
                  onClick={handleSaveSecret}
                  disabled={!apiKey.trim() || isSavingSecret}
                  variant="secondary"
                >
                  {isSavingSecret
                    ? tCommon('actions.saving')
                    : tCommon('actions.save')}
                </Button>
              </HStack>
            </Stack>

            <Separator />

            {/* Models section */}
            <Stack gap={4}>
              <SectionHeader
                title={t('providers.models')}
                as="h3"
                size="sm"
                action={
                  <Button variant="secondary" size="sm" onClick={addModel}>
                    <Plus className="mr-1 size-3.5" />
                    {t('providers.addModel')}
                  </Button>
                }
              />

              {models.map((model, index) => (
                <Stack key={index} gap={3} className="rounded-lg border p-4">
                  <HStack justify="between" align="start">
                    <Text className="text-sm font-medium">
                      {model.displayName || model.id || `#${index + 1}`}
                    </Text>
                    <IconButton
                      icon={Trash2}
                      aria-label={t('providers.removeModel')}
                      className="text-muted-foreground hover:text-destructive size-7"
                      onClick={() => removeModel(index)}
                    />
                  </HStack>
                  <Input
                    label={t('providers.modelId')}
                    value={model.id}
                    onChange={(e) => updateModel(index, { id: e.target.value })}
                    placeholder={t('providers.modelIdPlaceholder')}
                    size="sm"
                  />
                  <Input
                    label={t('providers.displayName')}
                    value={model.displayName}
                    onChange={(e) =>
                      updateModel(index, { displayName: e.target.value })
                    }
                    placeholder={t('providers.modelDisplayNamePlaceholder')}
                    size="sm"
                  />
                  <Input
                    label={t('providers.description_field')}
                    value={model.description}
                    onChange={(e) =>
                      updateModel(index, { description: e.target.value })
                    }
                    placeholder={t('providers.modelDescriptionPlaceholder')}
                    size="sm"
                  />
                  <CheckboxGroup
                    label={t('providers.tags')}
                    options={TAG_VALUES.map((tag) => ({
                      value: tag,
                      label:
                        tag === 'chat'
                          ? t('providers.tagChat')
                          : tag === 'vision'
                            ? t('providers.tagVision')
                            : tag === 'embedding'
                              ? t('providers.tagEmbedding')
                              : tag,
                    }))}
                    value={model.tags}
                    onValueChange={(tags) => updateModel(index, { tags })}
                    columns={2}
                  />
                  {model.tags.includes('embedding') && (
                    <Input
                      label={t('providers.dimensions')}
                      type="number"
                      value={model.dimensions}
                      onChange={(e) =>
                        updateModel(index, { dimensions: e.target.value })
                      }
                      placeholder={t('providers.dimensionsPlaceholder')}
                      size="sm"
                    />
                  )}
                </Stack>
              ))}
            </Stack>

            <Separator />

            {/* Actions */}
            <HStack justify="between">
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 size-4" />
                {t('providers.deleteProvider')}
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? tCommon('actions.saving') : tCommon('actions.save')}
              </Button>
            </HStack>
          </Stack>
        )}
      </Sheet>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('providers.deleteProvider')}
        description={t('providers.deleteConfirm')}
        variant="destructive"
        confirmText={tCommon('actions.delete')}
        loadingText={tCommon('actions.deleting')}
        isLoading={isDeleting}
        onConfirm={handleDelete}
      />
    </>
  );
}
