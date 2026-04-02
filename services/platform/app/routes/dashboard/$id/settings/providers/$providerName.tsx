import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Card } from '@/app/components/ui/layout/card';
import { Grid, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import {
  useDeleteProvider,
  useSaveProvider,
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
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  component: ProviderDetailRoute,
});

function ProviderDetailRoute() {
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
        <Text variant="muted">Provider not found: {providerName}</Text>
        <Link
          to="/dashboard/$id/settings/providers"
          params={{ id: organizationId }}
        >
          <Button variant="secondary">Back to providers</Button>
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
  const { config, isDirty, isSaving, resetConfig, markSaving } =
    useProviderConfig();
  const saveProvider = useSaveProvider();
  const deleteProvider = useDeleteProvider();

  const handleSave = useCallback(async () => {
    markSaving(true);
    try {
      await saveProvider.mutateAsync({
        orgSlug: 'default',
        providerName,
        config,
      });
    } finally {
      markSaving(false);
    }
  }, [config, providerName, saveProvider, markSaving]);

  const handleDelete = useCallback(async () => {
    await deleteProvider.mutateAsync({
      orgSlug: 'default',
      providerName,
    });
    void navigate({
      to: '/dashboard/$id/settings/providers',
      params: { id: organizationId },
    });
  }, [providerName, organizationId, deleteProvider, navigate]);

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
        <HStack gap={2}>
          {isDirty && (
            <>
              <Button variant="secondary" size="sm" onClick={resetConfig}>
                {t('providers.discard')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('providers.saving') : t('providers.save')}
              </Button>
            </>
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            {t('providers.deleteProvider')}
          </Button>
        </HStack>
      </HStack>

      <GeneralSection />
      <ApiKeySection providerName={providerName} />
      <ModelsSection />
    </Stack>
  );
}

function GeneralSection() {
  const { t } = useT('settings');
  const { config, updateConfig } = useProviderConfig();

  return (
    <Card contentClassName="p-5">
      <Stack gap={4}>
        <Text as="span" variant="label" className="text-base">
          {t('providers.general')}
        </Text>
        <div>
          <Text as="label" variant="muted" className="mb-1.5 block text-sm">
            {t('providers.displayName')}
          </Text>
          <Input
            value={config.displayName}
            onChange={(e) => updateConfig({ displayName: e.target.value })}
          />
        </div>
        <div>
          <Text as="label" variant="muted" className="mb-1.5 block text-sm">
            {t('providers.description')}
          </Text>
          <Textarea
            value={config.description ?? ''}
            onChange={(e) => updateConfig({ description: e.target.value })}
            rows={3}
          />
        </div>
        <div>
          <Text as="label" variant="muted" className="mb-1.5 block text-sm">
            {t('providers.baseUrl')}
          </Text>
          <Input
            value={config.baseUrl}
            onChange={(e) => updateConfig({ baseUrl: e.target.value })}
          />
        </div>
      </Stack>
    </Card>
  );
}

function ApiKeySection({ providerName }: { providerName: string }) {
  const { t } = useT('settings');
  const { data: hasSecret } = useHasProviderSecret('default', providerName);
  const saveSecret = useSaveProviderSecret();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await saveSecret.mutateAsync({
        orgSlug: 'default',
        providerName,
        apiKey: apiKey.trim(),
      });
      setApiKey('');
    } finally {
      setSaving(false);
    }
  }, [apiKey, providerName, saveSecret]);

  return (
    <Card contentClassName="p-5">
      <Stack gap={3}>
        <HStack justify="between" align="center">
          <Text as="span" variant="label" className="text-base">
            {t('providers.apiKey')}
          </Text>
          {hasSecret ? (
            <Badge variant="green">{t('providers.apiKeyConfigured')}</Badge>
          ) : (
            <Badge variant="outline">
              {t('providers.apiKeyNotConfigured')}
            </Badge>
          )}
        </HStack>
        <HStack gap={2}>
          <Input
            type="password"
            placeholder={
              hasSecret
                ? t('providers.apiKeyReplace')
                : t('providers.apiKeyEnter')
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="max-w-md"
          />
          <Button
            size="sm"
            onClick={handleSaveKey}
            disabled={!apiKey.trim() || saving}
          >
            {saving ? t('providers.saving') : t('providers.saveKey')}
          </Button>
        </HStack>
      </Stack>
    </Card>
  );
}

function ModelsSection() {
  const { t } = useT('settings');
  const { config, updateConfig } = useProviderConfig();

  const addModel = useCallback(() => {
    const newModel = {
      id: '',
      displayName: '',
      tags: ['chat' as const],
    };
    updateConfig({ models: [...config.models, newModel] });
  }, [config.models, updateConfig]);

  const updateModel = useCallback(
    (index: number, partial: Record<string, unknown>) => {
      const updated = config.models.map((m, i) =>
        i === index ? { ...m, ...partial } : m,
      );
      updateConfig({ models: updated });
    },
    [config.models, updateConfig],
  );

  const removeModel = useCallback(
    (index: number) => {
      updateConfig({ models: config.models.filter((_, i) => i !== index) });
    },
    [config.models, updateConfig],
  );

  return (
    <Stack gap={3}>
      <HStack justify="between" align="center">
        <Text as="span" variant="label" className="text-base">
          {t('providers.models')}
        </Text>
        <Button variant="secondary" size="sm" onClick={addModel}>
          <Plus className="mr-1.5 size-4" />
          {t('providers.addModel')}
        </Button>
      </HStack>

      {config.models.map((model, index) => (
        <Card key={index} contentClassName="p-4">
          <Stack gap={3}>
            <HStack justify="between" align="start">
              <Stack gap={3} className="flex-1">
                <div>
                  <Text
                    as="label"
                    variant="muted"
                    className="mb-1 block text-xs"
                  >
                    {t('providers.modelId')}
                  </Text>
                  <Input
                    value={model.id}
                    onChange={(e) => updateModel(index, { id: e.target.value })}
                    placeholder="provider/model-name"
                  />
                </div>
                <div>
                  <Text
                    as="label"
                    variant="muted"
                    className="mb-1 block text-xs"
                  >
                    {t('providers.displayName')}
                  </Text>
                  <Input
                    value={model.displayName}
                    onChange={(e) =>
                      updateModel(index, { displayName: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Text
                    as="label"
                    variant="muted"
                    className="mb-1 block text-xs"
                  >
                    {t('providers.description')}
                  </Text>
                  <Textarea
                    value={model.description ?? ''}
                    onChange={(e) =>
                      updateModel(index, {
                        description: e.target.value || undefined,
                      })
                    }
                    placeholder={t('providers.modelDescriptionPlaceholder')}
                    rows={2}
                  />
                </div>
              </Stack>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeModel(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </HStack>

            <HStack gap={4} align="center" className="flex-wrap">
              {(['chat', 'vision', 'embedding'] as const).map((tag) => (
                <label key={tag} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={model.tags.includes(tag)}
                    onCheckedChange={(checked) => {
                      const tags = checked
                        ? [...model.tags, tag]
                        : model.tags.filter((v) => v !== tag);
                      updateModel(index, { tags });
                    }}
                  />
                  {tag}
                </label>
              ))}
              {model.tags.includes('embedding') && (
                <div className="flex items-center gap-1.5">
                  <Text as="span" variant="muted" className="text-xs">
                    {t('providers.dimensions')}:
                  </Text>
                  <Input
                    type="number"
                    value={model.dimensions ?? ''}
                    onChange={(e) =>
                      updateModel(index, {
                        dimensions: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-24"
                  />
                </div>
              )}
            </HStack>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
