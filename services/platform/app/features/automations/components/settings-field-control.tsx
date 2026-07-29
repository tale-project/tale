'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import type {
  SettingsField,
  SettingsForm,
} from '@/lib/shared/schemas/automation_settings';

import type { SettingsFieldIssue } from '../hooks/use-settings-editor';

/** Locale resolution for declared text: exact tag wins over base language
 * over the authored (English) field — same chain the task contract uses. */
export function useLocalized() {
  const { locale } = useLocale();
  const base = locale.split('-')[0] ?? locale;
  return useMemo(
    () =>
      function localized<T extends object>(
        entity: T & { i18n?: Record<string, Partial<T>> },
      ): T {
        const { i18n, ...rest } = entity;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rest is T minus i18n; the overrides are Partial<T>
        return { ...rest, ...i18n?.[base], ...i18n?.[locale] } as T;
      },
    [base, locale],
  );
}

/** One declared settings field as its control, with the declaration's own
 *  label, help, placeholder and validation message. */
export function SettingsFieldControl({
  form,
  field,
  value,
  issue,
  disabled,
  onChange,
}: {
  form: SettingsForm;
  field: SettingsField;
  value: string;
  issue: SettingsFieldIssue | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useT('automations');
  const localized = useLocalized();
  const text = localized(field);
  const id = `automation-settings-${form.file}-${field.key}`;
  const errorMessage =
    issue === null ? undefined : t(`settings.errors.${issue}`);

  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={id}
        label={text.label}
        {...(text.help !== undefined && { description: text.help })}
        checked={value === 'true'}
        onCheckedChange={(checked) =>
          onChange(checked === true ? 'true' : 'false')
        }
        disabled={disabled}
      />
    );
  }
  if (field.type === 'select') {
    const options = (field.options ?? []).map((option) => ({
      value: option.value,
      label: localized(option).label,
    }));
    return (
      <Select
        id={id}
        label={text.label}
        options={options}
        value={value === '' ? undefined : value}
        onValueChange={onChange}
        {...(text.placeholder !== undefined && {
          placeholder: text.placeholder,
        })}
        {...(text.help !== undefined && { description: text.help })}
        required={field.required === true}
        error={issue !== null}
        disabled={disabled}
      />
    );
  }
  return (
    <Input
      id={id}
      label={text.label}
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...(text.placeholder !== undefined && {
        placeholder: text.placeholder,
      })}
      {...(text.help !== undefined && { description: text.help })}
      {...(errorMessage !== undefined && { errorMessage })}
      required={field.required === true}
      disabled={disabled}
    />
  );
}
