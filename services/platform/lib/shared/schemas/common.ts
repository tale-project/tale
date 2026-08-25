import { z } from 'zod/v4';

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
export type DataSource = z.infer<typeof dataSourceSchema>;
