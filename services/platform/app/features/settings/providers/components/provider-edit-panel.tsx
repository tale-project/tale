'use client';

import { useCallback, useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider } from '../hooks/mutations';
import { useReadProvider } from '../hooks/queries';

interface ProviderEditPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
}

export function ProviderEditPanel({
  open,
  onOpenChange,
  providerName,
}: ProviderEditPanelProps) {
  const { t } = useT('settings');
  const { data } = useReadProvider('default', providerName);
  const { mutateAsync: saveProvider, isPending } = useSaveProvider();

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    description: '',
    baseUrl: '',
  });

  useEffect(() => {
    if (data?.ok) {
      setForm({
        name: providerName,
        displayName: data.config.displayName,
        description: data.config.description ?? '',
        baseUrl: data.config.baseUrl,
      });
    }
  }, [data, providerName]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!data?.ok) return;
      try {
        await saveProvider({
          orgSlug: 'default',
          providerName,
          config: {
            ...data.config,
            displayName: form.displayName,
            description: form.description || undefined,
            baseUrl: form.baseUrl,
          },
        });
        toast({ title: t('providers.saved'), variant: 'success' });
        onOpenChange(false);
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [data, form, providerName, saveProvider, t, onOpenChange],
  );

  const isValid =
    form.displayName.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    URL.canParse(form.baseUrl.trim());

  const isDirty =
    !!data?.ok &&
    (form.displayName !== data.config.displayName ||
      form.description !== (data.config.description ?? '') ||
      form.baseUrl !== data.config.baseUrl);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.editGeneralTitle')}
      onSubmit={handleSubmit}
      isSubmitting={isPending}
      isDirty={isDirty}
      isValid={isValid}
      submitText={t('providers.saveChanges')}
      submittingText={t('providers.saving')}
    >
      <Input label={t('providers.name')} value={form.name} disabled readOnly />
      <Text variant="caption" className="text-muted-foreground -mt-2">
        {t('providers.nameReadonlyHelp')}
      </Text>

      <Input
        label={t('providers.displayName')}
        value={form.displayName}
        onChange={(e) =>
          setForm((f) => ({ ...f, displayName: e.target.value }))
        }
        placeholder={t('providers.displayNamePlaceholder')}
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
        onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
        placeholder={t('providers.baseUrlPlaceholder')}
      />
    </FormDialog>
  );
}
