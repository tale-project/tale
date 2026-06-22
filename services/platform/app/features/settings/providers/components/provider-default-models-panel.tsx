'use client';

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useCallback, useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Select } from '@/app/components/ui/forms/select';
import { ModelInfoPopover } from '@/app/features/chat/components/model-info-popover';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider } from '../hooks/mutations';
import { useModelCapabilities, useReadProvider } from '../hooks/queries';
import { modelTagLabel } from '../utils/model-tag-label';

const NONE_VALUE = '__none__';

// Tags that can be set as a per-provider default. Mirrors
// `providerDefaultsSchema` keys in `lib/shared/schemas/providers.ts`.
const DEFAULT_TAGS = [
  'chat',
  'vision',
  'embedding',
  'image-generation',
  'transcription',
] as const;

interface ProviderDefaultModelsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  providerName: string;
}

export function ProviderDefaultModelsPanel({
  open,
  onOpenChange,
  organizationId,
  providerName,
}: ProviderDefaultModelsPanelProps) {
  const { t } = useT('settings');
  const { data } = useReadProvider(organizationId, providerName);
  const { mutateAsync: saveProvider, isPending } = useSaveProvider();

  const [defaults, setDefaults] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data?.ok) {
      setDefaults({ ...data.config.defaults });
    }
  }, [data]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!data?.ok) return;
      const cleanedDefaults = Object.fromEntries(
        Object.entries(defaults).filter(([, v]) => v && v !== NONE_VALUE),
      );
      try {
        await saveProvider({
          organizationId,
          providerName,
          config: {
            ...data.config,
            defaults:
              Object.keys(cleanedDefaults).length > 0
                ? cleanedDefaults
                : undefined,
          },
        });
        toast({ title: t('providers.saved'), variant: 'success' });
        onOpenChange(false);
      } catch (err) {
        console.error('[ProviderDefaultModelsPanel] save failed', err);
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [
      data,
      defaults,
      organizationId,
      providerName,
      saveProvider,
      t,
      onOpenChange,
    ],
  );

  const isDirty =
    !!data?.ok &&
    DEFAULT_TAGS.some(
      (tag) =>
        (defaults[tag] ?? NONE_VALUE) !==
        (data.config.defaults?.[tag] ?? NONE_VALUE),
    );

  const models = data?.ok ? data.config.models : [];

  const capabilities = useModelCapabilities(
    organizationId,
    models.map((m) => m.id),
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.editDefaultModels')}
      onSubmit={handleSubmit}
      isSubmitting={isPending}
      isDirty={isDirty}
      submitText={t('providers.saveChanges')}
      submittingText={t('providers.saving')}
    >
      <Text className="text-muted-foreground text-sm">
        {t('providers.defaultModelsDescription')}
      </Text>
      {DEFAULT_TAGS.map((tag) => {
        const modelsWithTag = models.filter((m) =>
          (m.tags as readonly string[]).includes(tag),
        );
        const selectedId = defaults[tag];
        const selected =
          selectedId && selectedId !== NONE_VALUE
            ? modelsWithTag.find((m) => m.id === selectedId)
            : undefined;
        return (
          <Row key={tag} gap={2} align="end">
            <Select
              wrapperClassName="flex-1"
              label={modelTagLabel(tag, t)}
              options={[
                {
                  value: NONE_VALUE,
                  label: t('providers.defaultNone'),
                },
                ...modelsWithTag.map((m) => ({
                  value: m.id,
                  label: m.displayName,
                })),
              ]}
              value={defaults[tag] ?? NONE_VALUE}
              onValueChange={(value) =>
                setDefaults((d) => ({ ...d, [tag]: value }))
              }
            />
            {/* Match the default trigger's height (h-10) so the info icon
                centers against the select, not its label. */}
            <Row gap={0} className="h-10">
              {selected ? (
                <ModelInfoPopover
                  tags={selected.tags as string[]}
                  capabilities={capabilities.get(selected.id)}
                  organizationId={organizationId}
                  triggerClassName="mt-0"
                />
              ) : null}
            </Row>
          </Row>
        );
      })}
    </FormDialog>
  );
}
