import type { SearchStrategy } from '../types';

/** Documents are searched by title (substring). Trashed/expired rows are
 *  excluded via `activeOnly`. Swap `engine` to `'searchIndex'` (+
 *  `searchIndexName: 'search_documents'`, `searchIndexField: 'title'`) once
 *  the bootstrap is fixed — see `TODO(search-index-disabled)`. */
export const documentsSearchStrategy: SearchStrategy<'documents'> = {
  table: 'documents',
  orgIndex: 'by_organizationId',
  textFields: ['title'],
  activeOnly: true,
  engine: 'scan',
};
