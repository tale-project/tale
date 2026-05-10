'use client';

import { useCallback, useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useProviderConfig } from '../hooks/use-provider-config-context';
import {
  dispatchForbiddenDeveloperSettings,
  dispatchVersionConflict,
} from '../utils/error-dispatch';

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
  // Route through ProviderConfigContext rather than reading/writing the
  // provider directly. This way `expectedHash` round-trips and our save
  // doesn't silently revert sibling edits to providerOptions/models/defaults
  // captured in the context but not yet refetched.
  const { config, isSaving, saveConfig } = useProviderConfig();

  const [form, setForm] = useState({
    name: providerName,
    displayName: config.displayName,
    description: config.description ?? '',
    baseUrl: config.baseUrl,
  });

  // Re-sync form state from the context only when the dialog isn't open.
  // While the user is typing we deliberately keep their unsaved edits even
  // if a sibling save invalidates the read query.
  useEffect(() => {
    if (open) return;
    setForm({
      name: providerName,
      displayName: config.displayName,
      description: config.description ?? '',
      baseUrl: config.baseUrl,
    });
  }, [
    open,
    providerName,
    config.displayName,
    config.description,
    config.baseUrl,
  ]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await saveConfig({
          displayName: form.displayName,
          description: form.description || undefined,
          baseUrl: form.baseUrl,
        });
        toast({ title: t('providers.saved'), variant: 'success' });
        onOpenChange(false);
      } catch (err) {
        if (dispatchForbiddenDeveloperSettings(err, t)) return;
        if (dispatchVersionConflict(err, t)) return;
        console.error('[ProviderEditPanel] save failed', err);
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [form, saveConfig, t, onOpenChange],
  );

  const isValid =
    form.displayName.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    URL.canParse(form.baseUrl.trim());

  const isDirty =
    form.displayName !== config.displayName ||
    form.description !== (config.description ?? '') ||
    form.baseUrl !== config.baseUrl;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.editGeneralTitle')}
      onSubmit={handleSubmit}
      isSubmitting={isSaving}
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
