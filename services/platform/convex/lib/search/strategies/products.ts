import type { SearchStrategy } from '../types';

/**
 * Products, for WORD matching only.
 *
 * The fields here are the ones this format can express. `query_products.ts`
 * also matches a whole phrase against each translation's name and description,
 * and that check stays — the two run together, so a translated name is still
 * findable. Do not "tidy" one list to match the other: they differ on purpose,
 * and collapsing them would silently drop translation search.
 */
export const productsSearchStrategy: SearchStrategy<'products'> = {
  table: 'products',
  orgIndex: 'by_organizationId',
  textFields: ['name', 'description', 'category'],
  arrayTextFields: ['tags'],
  idFields: ['externalId'],
  engine: 'scan',
};
