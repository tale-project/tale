'use client';

import { useMemo } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useContacts } from '@/app/features/contacts/hooks/queries';
import { useT } from '@/lib/i18n/client';

/** Placeholder email a contact record carries when it has no real address. */
const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

interface ContactRecipientPickerProps {
  organizationId: string;
  /** Selected contact id, or null. */
  value: string | null;
  onChange: (contactId: string) => void;
  disabled?: boolean;
  error?: boolean;
}

/**
 * Recipient picker for the compose dialog — the same {@link SearchableSelect}
 * that backs the assignee/model/agent selectors, fed by the org's contacts.
 * Only contacts with a real email address are offered (a contact without one
 * can't be emailed — mirrors the reply path's `customer_email_not_found` guard).
 */
export function ContactRecipientPicker({
  organizationId,
  value,
  onChange,
  disabled,
  error,
}: ContactRecipientPickerProps) {
  const { t } = useT('conversations');
  const { contacts, isLoading } = useContacts(organizationId);

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      contacts
        .filter((c) => c.email && c.email !== UNKNOWN_CONTACT_EMAIL)
        .map((c) => {
          const name = c.name?.trim();
          return {
            value: c._id,
            label: name || c.email || c._id,
            description: name ? c.email : undefined,
          };
        }),
    [contacts],
  );

  return (
    <SearchableSelect
      label={t('compose.to')}
      required
      value={value}
      onValueChange={onChange}
      options={options}
      disabled={disabled}
      error={error}
      placeholder={t('compose.toPlaceholder')}
      searchPlaceholder={t('compose.searchContacts')}
      emptyText={
        isLoading ? t('compose.contactsLoading') : t('compose.noContacts')
      }
      aria-label={t('compose.to')}
    />
  );
}
