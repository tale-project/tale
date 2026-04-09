'use client';

import { useCallback, useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider } from '../hooks/mutations';
import { useReadProvider } from '../hooks/queries';

interface ProviderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
}

export function ProviderEditDialog({
  open,
  onOpenChange,
  providerName,
}: ProviderEditDialogProps) {
  const { t } = useT('settings');
  const { data } = useReadProvider('default', providerName);
  const { mutateAsync: saveProvider, isPending } = useSaveProvider();

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    baseUrl: '',
  });

  useEffect(() => {
    if (data?.ok) {
      setForm({
        name: providerName,
        displayName: data.config.displayName,
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

  const isDirty =
    data?.ok &&
    (form.displayName !== data.config.displayName ||
      form.baseUrl !== data.config.baseUrl);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.editProvider')}
      submitText={t('providers.saveChanges')}
      submittingText={t('providers.saving')}
      isSubmitting={isPending}
      isDirty={!!isDirty}
      onSubmit={handleSubmit}
    >
      <Input label={t('providers.name')} value={form.name} disabled readOnly />
      <Text variant="caption" className="-mt-2">
        {t('providers.nameHelp')}
      </Text>

      <Input
        label={t('providers.displayName')}
        value={form.displayName}
        onChange={(e) =>
          setForm((f) => ({ ...f, displayName: e.target.value }))
        }
        placeholder={t('providers.displayNamePlaceholder')}
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
