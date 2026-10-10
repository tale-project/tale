import { formatEnumLabel } from '@tale/ui/string';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import type { ContactInfo } from '@/backend/core/conversations/types';
import type { AppAbility } from '@/lib/permissions/ability';
import { isRecord } from '@/lib/utils/type-utils';

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
function isEditableContact(contact: ContactDoc): boolean {
  return contact.source === 'manual_import' || contact.source === 'file_upload';
}

/**
 * Whether this member may edit or delete the contact: a writer, on one of the
 * organization's own records. The row menu, the details dialog and the list's
 * bulk delete all ask this, so no second path offers what the first withholds
 * (#3623: the checkboxes deleted synced contacts the menu protected).
 */
export function canEditContact(
  ability: AppAbility,
  contact: ContactDoc,
): boolean {
  return ability.can('write', 'knowledgeWrite') && isEditableContact(contact);
}

/** Whether the contact has a real address to compose an email to. */
export function canEmailContact(contact: ContactData): boolean {
  return Boolean(contact.email && contact.email !== UNKNOWN_CONTACT_EMAIL);
}

/** Vendor sources are proper nouns, spelled the vendor's way in every locale —
 *  start-casing the enum wrote "Hubspot", "Woocommerce" and "Sap". */
const VENDOR_SOURCE_NAMES: Readonly<Record<string, string>> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  magento: 'Magento',
  bigcommerce: 'BigCommerce',
  prestashop: 'PrestaShop',
  chargebee: 'Chargebee',
  stripe: 'Stripe',
  recurly: 'Recurly',
  salesforce: 'Salesforce',
  hubspot: 'HubSpot',
  pipedrive: 'Pipedrive',
  zoho: 'Zoho',
  sap: 'SAP',
  oracle: 'Oracle',
  netsuite: 'NetSuite',
  mailchimp: 'Mailchimp',
  klaviyo: 'Klaviyo',
  sendgrid: 'SendGrid',
  zapier: 'Zapier',
};

/**
 * The label for a contact's `source` — one mapping for the table's Source
 * column, the details dialog and the conversation popover, so the three never
 * drift apart (#2643). The sources the app names in words ("Manual", "API")
 * are translated through the `contacts` namespace, the same words the Source
 * filter offers; vendors keep their own spelling. An enum value added later
 * falls back to start-casing rather than printing nothing.
 */
export function getContactSourceLabel(
  source: string | null | undefined,
  tContacts: (key: string) => string,
  unknownLabel: string,
): string {
  switch (source) {
    case 'manual_import':
      return tContacts('filter.source.manual');
    case 'file_upload':
      return tContacts('filter.source.upload');
    case 'api_import':
      return tContacts('filter.source.api');
    case 'conversation':
      return tContacts('filter.source.conversation');
    case 'webhook':
      return tContacts('filter.source.webhook');
    case 'custom':
      return tContacts('filter.source.custom');
    default:
      return (
        (source ? VENDOR_SOURCE_NAMES[source] : undefined) ??
        formatEnumLabel(source, unknownLabel)
      );
  }
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

/**
 * The words one address value holds: a string or a number as written, an
 * object or a list (`{line1, line2}`, a list of lines) as the words of its
 * values in order, joined with commas; a flag or `null` holds none. The walk
 * keeps its own stack, as the door's bound check does, so no stored nesting
 * can exhaust the call stack.
 */
function addressText(value: unknown): string {
  const words: string[] = [];
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === 'string') {
      const word = next.trim();
      if (word !== '') words.push(word);
    } else if (typeof next === 'number') {
      words.push(String(next));
    } else if (typeof next === 'object' && next !== null) {
      const children = Object.values(next);
      // Pushed last-first, so they pop in their stored order.
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push(children[index]);
      }
    }
  }
  return words.join(', ');
}

/**
 * The lines the details dialog shows for a contact's address: the street;
 * the city and state together; the postal code; the country. `address` is a
 * free-form object on the door, so any JSON can sit under any of these keys:
 * each is read through `addressText` rather than handed to React, where a
 * nested object threw and replaced the whole dialog with its error display
 * (#3625). A line with no words is left out; other keys stay stored but are
 * not shown.
 */
export function getContactAddressLines(address: unknown): string[] {
  if (!isRecord(address)) return [];
  const field = (key: string) => addressText(address[key]);
  return [
    field('street'),
    [field('city'), field('state')].filter(Boolean).join(', '),
    field('postalCode'),
    field('country'),
  ].filter(Boolean);
}
