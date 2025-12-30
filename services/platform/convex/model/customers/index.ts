/**
 * Customer model - Central export point
 *
 * This file exports all customer business logic functions and types.
 */

// Export validators
export * from './validators';

// Export types
export * from './types';

// Export internal business logic functions
export { createCustomer } from './create_customer';
export type { CreateCustomerArgs } from './create_customer';

export { getCustomerById } from './get_customer_by_id';

export { queryCustomers } from './query_customers';
export type { QueryCustomersArgs } from './query_customers';

export { updateCustomers } from './update_customers';
export type { UpdateCustomersArgs } from './update_customers';

export { updateCustomerMetadata } from './update_customer_metadata';
export type { UpdateCustomerMetadataResult } from './update_customer_metadata';

// Export public business logic functions
export { getCustomer } from './get_customer';

export { createCustomerPublic } from './create_customer_public';
export type { CreateCustomerPublicArgs } from './create_customer_public';

export { updateCustomer } from './update_customer';
export type { UpdateCustomerArgs } from './update_customer';

export { deleteCustomer } from './delete_customer';

export { bulkCreateCustomers } from './bulk_create_customers';
export type { BulkCreateCustomerData } from './bulk_create_customers';

export { getCustomerByEmail } from './get_customer_by_email';

export { getCustomerByExternalId } from './get_customer_by_external_id';

export { searchCustomers } from './search_customers';

export { findOrCreateCustomer } from './find_or_create_customer';
export type {
  FindOrCreateCustomerArgs,
  FindOrCreateCustomerResult,
} from './find_or_create_customer';

export { filterCustomers } from './filter_customers';

export { getCustomers } from './get_customers';
export type { GetCustomersArgs } from './get_customers';
