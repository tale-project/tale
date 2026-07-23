/**
 * Reading a credential row while BOTH shapes exist.
 *
 * The table admits the retired shape as well as the rebuilt one (see
 * `schema.ts`): a schema push necessarily precedes the re-key migration, so
 * an organization can legitimately hold rows the migration has not carried
 * over yet. Every live path in this domain operates on the REBUILT shape and
 * narrows here first — a retired row is invisible to it (not listed, not
 * resolvable, not patchable) until the migration converts it, which is the
 * only honest reading: the row's secret is still in the retired envelope and
 * nothing here can open it.
 *
 * The generated `Doc` type flattens the schema's two branches into one object
 * with everything but the organization optional, so the branch a row belongs
 * to is a RUNTIME question. `connectorSlug` answers it: the retired branch is
 * a strict `v.object` that has no such field, so a row carrying one validated
 * against the rebuilt branch and therefore carries every rebuilt field.
 *
 * This module comes out with the retired branch of the schema.
 */

import type { Doc } from '../_generated/dataModel';

/** A credential row the re-key migration has already carried over — the
 * shape the whole domain is written against. */
export type IntegrationCredentialRow = Doc<'integrationCredentials'> & {
  connectorSlug: string;
  authMethod: 'api-key' | 'bearer' | 'basic' | 'oauth2';
  name: string;
  encryptedData: NonNullable<Doc<'integrationCredentials'>['encryptedData']>;
  isDefault: boolean;
  status: 'active' | 'disabled' | 'needs-reauth';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

/** True for a row in the rebuilt shape. */
export function isRebuiltRow(
  row: Doc<'integrationCredentials'>,
): row is IntegrationCredentialRow {
  return row.connectorSlug !== undefined;
}
