import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { saveProviderDefinition } from '../providers/config.ts';
import {
  assertCredentialAdmin,
  CredentialAdminError,
  updateCredential,
  type CredentialScope,
  type UpdateCredentialPatch,
} from './service.ts';

/**
 * One Save of the edit dialog for a credential of an organization-defined
 * provider: the credential's fields and the provider's definition (its base
 * URL, API format, model listing and display name), which the dialog shows
 * as one form. Both land in the definition save's transaction, under the
 * providers lock, each against the version the dialog read: a refusal of
 * either (a name a sibling credential carries, a definition or credential
 * someone saved since) writes neither, and the definition file — the part
 * a rollback cannot reach — is written last.
 */
export async function updateCredentialWithDefinition(
  sql: Sql,
  scope: CredentialScope,
  orgSlug: string,
  credentialId: string,
  patch: UpdateCredentialPatch,
  expectedHash: string,
  definition: { config: ProviderDefinition; expectedHash: string },
): Promise<void> {
  assertCredentialAdmin(scope);
  await saveProviderDefinition(
    sql,
    {
      organizationId: scope.organizationId,
      orgSlug,
      userId: scope.userId,
      ...(scope.email !== undefined ? { email: scope.email } : {}),
    },
    definition.config.name,
    definition.config,
    definition.expectedHash,
    {
      alongside: async (tx) => {
        // Locked to the commit, so no writer moves the row between its hash
        // check and its update.
        const rows = await tx<{ providerSlug: string }[]>`
          SELECT provider_slug AS "providerSlug" FROM app.provider_credentials
          WHERE id = ${credentialId} AND org_id = ${scope.organizationId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) {
          throw new CredentialAdminError(
            'CREDENTIAL_NOT_FOUND',
            'Credential not found',
            404,
          );
        }
        if (row.providerSlug !== definition.config.name) {
          throw new ConfigurationError(
            'PROVIDER_DEFINITION_INVALID',
            "The definition is not the credential's provider.",
            400,
          );
        }
        await updateCredential(tx, scope, credentialId, patch, expectedHash);
      },
    },
  );
}
