'use client';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { useDebounce } from '@tale/ui/use-debounce';
import { toast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import * as z from 'zod';

import { ContactCreateDialog } from '@/app/features/contacts/components/contact-create-dialog';
import { useContact, useContacts } from '@/app/features/contacts/hooks/queries';
import {
  canEmailContact,
  UNKNOWN_CONTACT_EMAIL,
} from '@/app/features/contacts/lib/contact-data';
import { useAbility } from '@/app/hooks/use-ability';
import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { useT } from '@/lib/i18n/client';

/** Marks the "add what you typed" row, carrying the address it would create.
 *  Reading the address off the value rather than off the component's own
 *  state keeps the handler independent of when the picker resets its query
 *  (selecting a row closes the popover, which clears it). */
const CREATE_PREFIX = '__create_contact__:';

const emailSchema = z.string().email();

interface ContactRecipientPickerProps {
  organizationId: string;
  /** Selected contact id, or null. */
  value: string | null;
  onChange: (contactId: string) => void;
  disabled?: boolean;
  error?: boolean;
}

function toOption(contact: {
  _id: string;
  name?: string;
  email?: string;
}): SearchableSelectOption {
  const name = contact.name?.trim();
  return {
    value: contact._id,
    label: name || contact.email || contact._id,
    ...(name && contact.email ? { description: contact.email } : {}),
  };
}

/**
 * Recipient picker for the compose pane — the same {@link SearchableSelect}
 * that backs the assignee/model/agent selectors, fed by the org's contacts.
 *
 * The typed query narrows the list SERVER-side, so a contact beyond the
 * listing's first page is reachable; the selected contact is read by id and
 * pinned, so narrowing the list never blanks the trigger. Only contacts with
 * a real email address are offered (a contact without one can't be emailed —
 * mirrors the reply path's `customer_email_not_found` guard).
 *
 * An address that matches no contact is offered as a contact to create, so
 * writing to somebody new does not mean leaving compose for the Contacts
 * page. The offer is withheld unless the person may write contacts, because
 * the create door refuses them anyway.
 */
export function ContactRecipientPicker({
  organizationId,
  value,
  onChange,
  disabled,
  error,
}: ContactRecipientPickerProps) {
  const { t } = useT('conversations');
  const ability = useAbility();
  const queryClient = useQueryClient();
  const triggerId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState('');
  const [addEmail, setAddEmail] = useState<string | null>(null);
  const typed = query.trim();
  const debounced = useDebounce(typed, 300);

  const { contacts, isLoading } = useContacts(organizationId, debounced);
  const selected = useContact(value ?? undefined);

  // Results for a query the user has already moved past are not an answer
  // about that query — offering "add this address" before the search that
  // would find it has landed is exactly the wrong moment.
  const isBusy = isLoading || typed !== debounced;

  const canWriteContacts = ability.can('write', 'knowledgeWrite');
  const wanted = typed.toLowerCase();
  const offerCreate =
    canWriteContacts &&
    !isBusy &&
    wanted !== '' &&
    wanted !== UNKNOWN_CONTACT_EMAIL &&
    emailSchema.safeParse(wanted).success &&
    // Scans the RAW rows, before the emailable filter: a contact the list is
    // hiding still owns its address, and offering to create it would only
    // earn a duplicate refusal.
    !contacts.some((c) => c.email?.trim().toLowerCase() === wanted);

  const options = useMemo<SearchableSelectOption[]>(() => {
    const rows = contacts.filter(canEmailContact).map(toOption);
    // The list is a search result, so the selected contact is routinely not
    // in it; pin it or the trigger loses the name it is showing.
    if (
      selected !== null &&
      canEmailContact(selected) &&
      !rows.some((row) => row.value === selected._id)
    ) {
      rows.unshift({ ...toOption(selected), alwaysVisible: true });
    }
    if (offerCreate) {
      rows.push({
        value: `${CREATE_PREFIX}${typed}`,
        label: t('compose.addContact', { email: typed }),
        alwaysVisible: true,
        // Its own group, so the primitive draws a divider above it.
        group: 'create',
      });
    }
    return rows;
  }, [contacts, selected, offerCreate, typed, t]);

  const emptyText = isBusy
    ? t('compose.contactsLoading')
    : typed === ''
      ? t('compose.noContacts')
      : canWriteContacts && !emailSchema.safeParse(wanted).success
        ? t('compose.noContactsFoundAddHint', { query: typed })
        : t('compose.noContactsFound', { query: typed });

  const handleValueChange = useCallback(
    (next: string) => {
      if (next.startsWith(CREATE_PREFIX)) {
        // The row that opened the dialog unmounts with the popover, so the
        // dialog needs a target that outlives it.
        restoreFocusRef.current = document.getElementById(triggerId);
        setAddEmail(next.slice(CREATE_PREFIX.length));
        return;
      }
      onChange(next);
    },
    [onChange, triggerId],
  );

  /**
   * The create was refused because the address is already taken — by a row
   * the search did not answer with (a contact added since, most likely by
   * someone else). Find it and use it rather than dead-ending on a toast.
   */
  const handleDuplicateEmail = useCallback(
    async (email: string): Promise<string | null> => {
      const address = email.trim().toLowerCase();
      try {
        await queryClient.invalidateQueries({
          queryKey: backendEntityPrefix(organizationId, 'contact'),
        });
        const rows = await ensureAdaptedQueryData(
          queryClient,
          'contacts/queries:listContacts',
          { organizationId, search: address },
        );
        const match = rows.find(
          (row) => row.email?.trim().toLowerCase() === address,
        );
        if (match === undefined) return null;
        toast({
          title: t('compose.contactExistsSelected'),
          variant: 'success',
        });
        return match._id;
      } catch (lookupError) {
        console.error('Failed to resolve the existing contact:', lookupError);
        return null;
      }
    },
    [queryClient, organizationId, t],
  );

  return (
    <>
      <SearchableSelect
        id={triggerId}
        label={t('compose.to')}
        required
        value={value}
        onValueChange={handleValueChange}
        onSearchChange={setQuery}
        options={options}
        disabled={disabled}
        error={error}
        placeholder={t('compose.toPlaceholder')}
        searchPlaceholder={t('compose.searchContacts')}
        emptyText={emptyText}
        aria-label={t('compose.to')}
      />

      {addEmail !== null && (
        <ContactCreateDialog
          isOpen
          organizationId={organizationId}
          initialEmail={addEmail}
          onClose={() => setAddEmail(null)}
          onCreated={onChange}
          onDuplicateEmail={handleDuplicateEmail}
          restoreFocusRef={restoreFocusRef}
        />
      )}
    </>
  );
}
