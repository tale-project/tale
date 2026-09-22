import { z } from 'zod/v4';

/** Contact forms and file imports accept language, language-region and
 * language-script tags, including the underscore spelling used by exports. */
export const CONTACT_LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/i;

/** Digits plus common phone punctuation. At least one digit required. */
export const CONTACT_PHONE_PATTERN = /^[+]?[\d\s().\-]*\d[\d\s().\-]*$/;

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
