'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { LocaleTabs } from '@/app/components/ui/i18n/locale-tabs';
import { Text } from '@/app/components/ui/typography/text';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_LOCALES } from '@/lib/shared/constants/locales';
import type { ProviderJson } from '@/lib/shared/schemas/providers';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

import { useProviderConfig } from '../hooks/use-provider-config-context';
import {
  dispatchForbiddenDeveloperSettings,
  dispatchVersionConflict,
} from '../utils/error-dispatch';

interface ProviderEditPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  organizationId: string;
}

interface PerLocaleFields {
  displayName: string;
  description: string;
}

type PerLocaleMap = Record<string, PerLocaleFields>;

function buildPerLocale(
  config: ProviderJson,
  defaultLocale: string,
): PerLocaleMap {
  const out: PerLocaleMap = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === defaultLocale) {
      out[locale] = {
        displayName: config.displayName,
        description: config.description ?? '',
      };
    } else {
      out[locale] = {
        displayName: config.i18n?.[locale]?.displayName ?? '',
        description: config.i18n?.[locale]?.description ?? '',
      };
    }
  }
  return out;
}

export function ProviderEditPanel({
  open,
  onOpenChange,
  providerName,
  organizationId,
}: ProviderEditPanelProps) {
  const { t } = useT('settings');
  // Route through ProviderConfigContext rather than reading/writing the
  // provider directly. This way `expectedHash` round-trips and our save
  // doesn't silently revert sibling edits to providerOptions/models/defaults
  // captured in the context but not yet refetched.
  const { config, isSaving, saveConfig } = useProviderConfig();
  const { data: organization } = useOrganization(organizationId);
  const defaultLocale = getOrganizationDefaultLocale(organization?.metadata);

  const [editingLocale, setEditingLocale] = useState(defaultLocale);
  const [form, setForm] = useState({
    name: providerName,
    baseUrl: config.baseUrl,
    perLocale: buildPerLocale(config, defaultLocale),
  });

  // Re-sync form state from the context only when the dialog isn't open.
  // While the user is typing we deliberately keep their unsaved edits even
  // if a sibling save invalidates the read query.
  useEffect(() => {
    if (open) return;
    setForm({
      name: providerName,
      baseUrl: config.baseUrl,
      perLocale: buildPerLocale(config, defaultLocale),
    });
    setEditingLocale(defaultLocale);
  }, [open, providerName, config, defaultLocale]);

  // Org metadata loads async — if `defaultLocale` resolves *after* the panel
  // already mounted (initial render uses the app fallback 'en'), pivot the
  // active tab and rebuild perLocale so the source-of-truth tab points at
  // the org's actual default. We don't reset existing edits — `setForm` only
  // rewrites the `perLocale` map, preserving other fields.
  const initialDefaultLocaleRef = useRef(defaultLocale);
  useEffect(() => {
    if (!open) return;
    if (defaultLocale === initialDefaultLocaleRef.current) return;
    initialDefaultLocaleRef.current = defaultLocale;
    setEditingLocale(defaultLocale);
    setForm((f) => ({
      ...f,
      perLocale: buildPerLocale(config, defaultLocale),
    }));
  }, [open, defaultLocale, config]);

  const updateLocaleField = useCallback(
    (locale: string, field: keyof PerLocaleFields, value: string) => {
      setForm((f) => ({
        ...f,
        perLocale: {
          ...f.perLocale,
          [locale]: { ...f.perLocale[locale], [field]: value },
        },
      }));
    },
    [],
  );

  const hasTranslation = useCallback(
    (locale: string): boolean => {
      const fields = form.perLocale[locale];
      return !!(fields?.displayName.trim() || fields?.description.trim());
    },
    [form.perLocale],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const defaultFields = form.perLocale[defaultLocale];
      // Rebuild i18n: preserve any existing per-locale `models` overrides
      // (those are authored in the JSON today and outside this UI's scope).
      const newI18n: NonNullable<ProviderJson['i18n']> = {};
      for (const locale of SUPPORTED_LOCALES) {
        if (locale === defaultLocale) continue;
        const { displayName, description } = form.perLocale[locale];
        const dn = displayName.trim();
        const desc = description.trim();
        const existingModels = config.i18n?.[locale]?.models;
        if (!dn && !desc) {
          if (existingModels && Object.keys(existingModels).length > 0) {
            newI18n[locale] = { models: existingModels };
          }
          continue;
        }
        newI18n[locale] = {
          ...(dn ? { displayName: dn } : {}),
          ...(desc ? { description: desc } : {}),
          ...(existingModels ? { models: existingModels } : {}),
        };
      }
      // Preserve any existing locales we don't know about (e.g. a future
      // supported locale that's already in the JSON). We only own the
      // SUPPORTED_LOCALES axis.
      for (const [locale, entry] of Object.entries(config.i18n ?? {})) {
        if (locale === defaultLocale) continue;
        if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
          newI18n[locale] = entry;
        }
      }

      try {
        await saveConfig({
          displayName: defaultFields.displayName.trim(),
          description: defaultFields.description.trim() || undefined,
          baseUrl: form.baseUrl,
          i18n: Object.keys(newI18n).length > 0 ? newI18n : undefined,
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
    [form, config.i18n, defaultLocale, saveConfig, t, onOpenChange],
  );

  const isValid = useMemo(() => {
    const baseValid =
      form.baseUrl.trim().length > 0 && URL.canParse(form.baseUrl.trim());
    const defaultDisplayName =
      form.perLocale[defaultLocale]?.displayName.trim() ?? '';
    return baseValid && defaultDisplayName.length > 0;
  }, [form.baseUrl, form.perLocale, defaultLocale]);

  const isDirty = useMemo(() => {
    if (form.baseUrl !== config.baseUrl) return true;
    for (const locale of SUPPORTED_LOCALES) {
      const next = form.perLocale[locale];
      if (locale === defaultLocale) {
        if (next.displayName !== config.displayName) return true;
        if (next.description !== (config.description ?? '')) return true;
      } else {
        if (next.displayName !== (config.i18n?.[locale]?.displayName ?? ''))
          return true;
        if (next.description !== (config.i18n?.[locale]?.description ?? ''))
          return true;
      }
    }
    return false;
  }, [form, config, defaultLocale]);

  const editingFields = form.perLocale[editingLocale] ?? {
    displayName: '',
    description: '',
  };

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
        label={t('providers.baseUrl')}
        value={form.baseUrl}
        onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
        placeholder={t('providers.baseUrlPlaceholder')}
      />

      <LocaleTabs
        defaultLocale={defaultLocale}
        editingLocale={editingLocale}
        onEditingLocaleChange={setEditingLocale}
        hasTranslation={hasTranslation}
      />

      <Input
        label={t('providers.displayName')}
        value={editingFields.displayName}
        onChange={(e) =>
          updateLocaleField(editingLocale, 'displayName', e.target.value)
        }
        placeholder={t('providers.displayNamePlaceholder')}
      />

      <Textarea
        label={t('providers.description_field')}
        value={editingFields.description}
        onChange={(e) =>
          updateLocaleField(editingLocale, 'description', e.target.value)
        }
        placeholder={t('providers.descriptionPlaceholder')}
        rows={3}
      />
    </FormDialog>
  );
}
