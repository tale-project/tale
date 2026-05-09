'use client';

import { useCallback, useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Select } from '@/app/components/ui/forms/select';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider } from '../hooks/mutations';
import { useReadProvider } from '../hooks/queries';
import { modelTagLabel } from '../utils/model-tag-label';

const NONE_VALUE = '__none__';

interface ProviderDefaultModelsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
}

export function ProviderDefaultModelsPanel({
  open,
  onOpenChange,
  providerName,
}: ProviderDefaultModelsPanelProps) {
  const { t } = useT('settings');
  const { data } = useReadProvider('default', providerName);
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
          orgSlug: 'default',
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
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [data, defaults, providerName, saveProvider, t, onOpenChange],
  );

  const isDirty =
    !!data?.ok &&
    (defaults.chat !== (data.config.defaults?.chat ?? NONE_VALUE) ||
      defaults.vision !== (data.config.defaults?.vision ?? NONE_VALUE) ||
      defaults.embedding !== (data.config.defaults?.embedding ?? NONE_VALUE) ||
      defaults.transcription !==
        (data.config.defaults?.transcription ?? NONE_VALUE));

  const models = data?.ok ? data.config.models : [];

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
      {(['chat', 'vision', 'embedding', 'transcription'] as const).map(
        (tag) => {
          const modelsWithTag = models.filter((m) =>
            (m.tags as readonly string[]).includes(tag),
          );
          return (
            <Select
              key={tag}
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
          );
        },
      )}
    </FormDialog>
  );
}
