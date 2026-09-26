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
