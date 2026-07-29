'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import {
  MultiSelect,
  type MultiSelectOption,
} from '@/app/components/ui/forms/multi-select';
import { useT } from '@/lib/i18n/client';

import type { CatalogModel } from '../hooks/queries';

interface ModelAllowlistFieldProps {
  /** The provider's current catalog (the pickable ids). */
  models: ReadonlyArray<CatalogModel>;
  /**
   * Free-entry mode for providers without any catalog (`catalog.source:
   * none`, e.g. Azure): the allowlist is typed as comma-separated ids
   * instead of picked from a listing — on Azure the ids are the resource's
   * deployment names and effectively define which models exist at all.
   */
  freeText?: boolean;
  value: string[];
  onValueChange: (next: string[]) => void;
  disabled?: boolean;
}

/** Comma-separated ids → trimmed, deduplicated list. */
function parseFreeTextIds(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id.length > 0) seen.add(id);
  }
  return [...seen];
}

/**
 * Optional model allowlist of a credential: a searchable multi-select over
 * the provider's catalog ids, or a comma-separated text field when the
 * provider has no catalog to pick from. Ids already on the credential but
 * missing from the current catalog (removed upstream, or the catalog is
 * degraded) stay listed so they remain visible and removable.
 */
export function ModelAllowlistField({
  models,
  freeText,
  value,
  onValueChange,
  disabled,
}: ModelAllowlistFieldProps) {
  const { t } = useT('settings');
  // Free-text drafts keep the raw string (in-progress commas and all) and
  // push the parsed list up on every change. The dialogs unmount this field
  // on close, so the draft can never go stale against a reopened form.
  const [text, setText] = useState(value.join(', '));

  const options = useMemo<MultiSelectOption[]>(() => {
    const catalogIds = new Set(models.map((model) => model.id));
    const stale = value.filter((id) => !catalogIds.has(id));
    return [
      ...models.map((model) => ({ value: model.id, label: model.id })),
      ...stale.map((id) => ({ value: id, label: id })),
    ];
  }, [models, value]);

  if (freeText) {
    return (
      <Input
        label={t('providers.dialog.allowlist')}
        description={t('providers.dialog.allowlistFreeTextHelp')}
        placeholder={t('providers.dialog.allowlistFreeTextPlaceholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onValueChange(parseFreeTextIds(e.target.value));
        }}
        disabled={disabled}
      />
    );
  }

  return (
    <MultiSelect
      label={t('providers.dialog.allowlist')}
      description={t('providers.dialog.allowlistHelp')}
      placeholder={t('providers.dialog.allowlistPlaceholder')}
      searchPlaceholder={t('providers.dialog.allowlistSearch')}
      emptyText={t('providers.dialog.allowlistEmpty')}
      removeChipLabel={(option) =>
        t('providers.dialog.removeModel', { model: option.label })
      }
      options={options}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      modal
    />
  );
}
