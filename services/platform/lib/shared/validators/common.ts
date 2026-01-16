import { z } from 'zod';
import { v } from 'convex/values';
import { createEnumValidator } from './utils/zod-to-convex';

export const sortOrderLiterals = ['asc', 'desc'] as const;
export const { zodSchema: sortOrderSchema, convexValidator: sortOrderValidator } =
	createEnumValidator(sortOrderLiterals);
export type SortOrder = z.infer<typeof sortOrderSchema>;

export const priorityLiterals = ['low', 'medium', 'high', 'urgent'] as const;
export const { zodSchema: prioritySchema, convexValidator: priorityValidator } =
	createEnumValidator(priorityLiterals);
export type Priority = z.infer<typeof prioritySchema>;

export const dataSourceLiterals = [
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
export const { zodSchema: dataSourceSchema, convexValidator: dataSourceValidator } =
	createEnumValidator(dataSourceLiterals);
export type DataSource = z.infer<typeof dataSourceSchema>;
