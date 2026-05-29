import type { SearchStrategy } from '../types';

/** Customers are searched by name + email (substring) and `externalId`
 *  (exact / substring). Soft-deleted rows are excluded. Swap `engine` to
 *  `'searchIndex'` (+ `searchIndexName: 'search_customers'`, `searchIndexField:
 *  'name'`) once the bootstrap is fixed — see `TODO(search-index-disabled)`. */
export const customersSearchStrategy: SearchStrategy<'customers'> = {
  table: 'customers',
  orgIndex: 'by_organizationId',
  textFields: ['name', 'email'],
  idFields: ['externalId'],
  activeOnly: true,
  engine: 'scan',
};
