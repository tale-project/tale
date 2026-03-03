import { z } from 'zod/v4';

const dataSourceLiterals = [
  'manual_import',
  'file_upload',
  'api_import',
  'shopify',
  'woocommerce',
  'magento',
  'bigcommerce',
  'prestashop',
  'circuly',
  'chargebee',
  'stripe',
  'recurly',
  'salesforce',
  'hubspot',
  'pipedrive',
  'zoho',
  'sap',
  'protel',
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
export type DataSource = z.infer<typeof dataSourceSchema>;
