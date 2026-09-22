import { formatEnumLabel } from '@tale/ui/string';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import type { ContactInfo } from '@/backend/core/conversations/types';

/**
 * A contact as rendered in the app: either a full directory row
 * (`ContactDoc`) or the lightweight `ContactInfo` embedded in a
 * conversation. The two share name/email/source/locale; the richer
 * phone/address/tags/notes fields live only on the directory row.
 */
export type ContactData = ContactDoc | ContactInfo;

export function isContactDoc(contact: ContactData): contact is ContactDoc {
  return '_creationTime' in contact;
}

/** Placeholder email a contact record carries when it has no real address
 *  (e.g. a conversation whose sender couldn't be resolved). Exported so the
 *  pickers that offer to CREATE a contact from a typed address can refuse
 *  this one, instead of each re-declaring the literal. */
export const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

/**
 * Whether a contact is the organization's own record to edit or delete: one a
 * person typed in or uploaded. Synced and conversation contacts belong to
 * their source, which would overwrite a local change.
 */
export function isEditableContact(contact: ContactDoc): boolean {
  return contact.source === 'manual_import' || contact.source === 'file_upload';
}

/** Whether the contact has a real address to compose an email to. */
export function canEmailContact(contact: ContactData): boolean {
  return Boolean(contact.email && contact.email !== UNKNOWN_CONTACT_EMAIL);
}

/**
 * Localized-casing label for a contact's `source` enum (e.g. `manual_import`
 * → "Manual Import") — thin re-export of the shared `formatEnumLabel` so the
 * details dialog / popover use the exact same mapping as the table's Source
 * column (`createSourceColumn` in column-builders.tsx) instead of a second,
 * independently-drifting implementation (#2643).
 */
export function getContactSourceLabel(
  source: string | null | undefined,
  unknownLabel: string,
): string {
  return formatEnumLabel(source, unknownLabel);
}

/**
 * Display value for a contact's `locale`. Unset locale renders as an
 * explicit em-dash rather than defaulting to `'en'` — a value nobody chose
 * shouldn't be asserted as fact (#2642).
 */
export function getContactLocaleLabel(
  locale: string | null | undefined,
): string {
  return locale || '—';
}
