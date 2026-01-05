/**
 * Common Convex validators shared across multiple models
 */

import { v } from 'convex/values';

/**
 * Sort order validator
 * Used for pagination and list queries across multiple models
 */
export const sortOrderValidator = v.union(v.literal('asc'), v.literal('desc'));

/**
 * Priority validator
 * Used for approvals, conversations, and other prioritized items
 */
export const priorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

/**
 * Data source validator
 * Used for customers, vendors, and other imported entities
 *
 * Categories:
 * - Manual: manual_import, file_upload, api_import
 * - E-commerce: shopify, woocommerce, magento, bigcommerce, prestashop
 * - Subscription/Rental: circuly, chargebee, stripe, recurly
 * - CRM: salesforce, hubspot, pipedrive, zoho
 * - ERP/PMS: sap, protel, oracle, netsuite
 * - Marketing: mailchimp, klaviyo, sendgrid
 * - Other: webhook, zapier, custom
 */
export const dataSourceValidator = v.union(
  // Manual sources
  v.literal('manual_import'),
  v.literal('file_upload'),
  v.literal('api_import'),
  // E-commerce platforms
  v.literal('shopify'),
  v.literal('woocommerce'),
  v.literal('magento'),
  v.literal('bigcommerce'),
  v.literal('prestashop'),
  // Subscription & rental platforms
  v.literal('circuly'),
  v.literal('chargebee'),
  v.literal('stripe'),
  v.literal('recurly'),
  // CRM platforms
  v.literal('salesforce'),
  v.literal('hubspot'),
  v.literal('pipedrive'),
  v.literal('zoho'),
  // ERP & PMS systems
  v.literal('sap'),
  v.literal('protel'),
  v.literal('oracle'),
  v.literal('netsuite'),
  // Marketing platforms
  v.literal('mailchimp'),
  v.literal('klaviyo'),
  v.literal('sendgrid'),
  // Other sources
  v.literal('webhook'),
  v.literal('zapier'),
  v.literal('custom'),
);

/**
 * TypeScript type for data source values
 * Inferred from the validator for type safety
 */
export type DataSource = typeof dataSourceValidator.type;
