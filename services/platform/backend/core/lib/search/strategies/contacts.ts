import type { SearchStrategy } from '../types';

/** Contacts are searched by name + email (substring) and `externalId`
 *  (exact / substring). Soft-deleted rows are excluded. Mirrors the former
 *  customers strategy (issue #2618). Swap `engine` to `'searchIndex'` (+
 *  `searchIndexName: 'search_contacts'`, `searchIndexField: 'name'`) once the
 *  bootstrap is fixed — see `TODO(search-index-disabled)`. */
export const contactsSearchStrategy: SearchStrategy<'contacts'> = {
  table: 'contacts',
  orgIndex: 'by_organizationId',
  textFields: ['name', 'email'],
  idFields: ['externalId'],
  activeOnly: true,
  engine: 'scan',
};
