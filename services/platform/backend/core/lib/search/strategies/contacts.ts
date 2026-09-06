import type { SearchStrategy } from '../types';

/** Contacts are searched by name + email (substring) and `externalId`
 *  (exact / substring). Mirrors the former customers strategy (issue #2618). */
export const contactsSearchStrategy: SearchStrategy<'contacts'> = {
  table: 'contacts',
  textFields: ['name', 'email'],
  idFields: ['externalId'],
};
