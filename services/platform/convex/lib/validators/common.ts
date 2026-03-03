/**
 * Common Convex validators shared across multiple domains
 */

import { v } from 'convex/values';

export const sortOrderValidator = v.union(v.literal('asc'), v.literal('desc'));

export const priorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

export const dataSourceValidator = v.union(
  v.literal('manual_import'),
  v.literal('file_upload'),
  v.literal('api_import'),
  v.literal('shopify'),
  v.literal('woocommerce'),
  v.literal('magento'),
  v.literal('bigcommerce'),
  v.literal('prestashop'),
  v.literal('circuly'),
  v.literal('chargebee'),
  v.literal('stripe'),
  v.literal('recurly'),
  v.literal('salesforce'),
  v.literal('hubspot'),
  v.literal('pipedrive'),
  v.literal('zoho'),
  v.literal('sap'),
  v.literal('protel'),
  v.literal('oracle'),
  v.literal('netsuite'),
  v.literal('mailchimp'),
  v.literal('klaviyo'),
  v.literal('sendgrid'),
  v.literal('webhook'),
  v.literal('zapier'),
  v.literal('custom'),
);
