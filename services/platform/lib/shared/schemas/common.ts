import { z } from 'zod/v4';

/** Contact forms and file imports accept language, language-region and
 * language-script tags, including the underscore spelling used by exports. */
export const CONTACT_LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/i;

/** Digits plus common phone punctuation. At least one digit required. */
export const CONTACT_PHONE_PATTERN = /^[+]?[\d\s().-]*\d[\d\s().-]*$/;

/**
 * The lengths the contact directory stores, read by the server's write
 * schema (`backend/domains/contacts/input-schema.ts`), the OpenAPI document
 * and the contact dialogs alike — so a value the form lets through is one
 * the door takes, instead of a 400 the form never explained.
 */
export const CONTACT_NAME_MAX = 300;
export const CONTACT_EMAIL_MAX = 320;
/** RFC 5321 §4.5.3.1.1: the part before `@` is at most 64 octets. */
export const CONTACT_EMAIL_LOCAL_PART_MAX = 64;
export const CONTACT_PHONE_MAX = 50;
export const CONTACT_EXTERNAL_ID_MAX = 256;
export const CONTACT_LOCALE_MAX = 20;
export const CONTACT_TAG_MAX = 60;
export const CONTACT_TAGS_MAX = 50;
export const CONTACT_NOTES_MAX = 10_000;

/**
 * How many rows one contact file import sends. The app door refuses a
 * longer list whole (`POST /api/app/contacts/bulk`), so the import dialog
 * checks the parsed file against the same number and asks for a split
 * before sending, instead of a 400 that names no row.
 */
export const CONTACT_IMPORT_ROWS_MAX = 1_000;

const dataSourceLiterals = [
  'manual_import',
  'file_upload',
  'api_import',
  'conversation',
  'shopify',
  'woocommerce',
  'magento',
  'bigcommerce',
  'prestashop',
  'chargebee',
  'stripe',
  'recurly',
  'salesforce',
  'hubspot',
  'pipedrive',
  'zoho',
  'sap',
  'oracle',
  'netsuite',
  'mailchimp',
  'klaviyo',
  'sendgrid',
  'webhook',
  'zapier',
  'custom',
] as const;
export const dataSourceSchema = z.enum(dataSourceLiterals);
