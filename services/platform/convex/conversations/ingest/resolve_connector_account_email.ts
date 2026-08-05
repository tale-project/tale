import { isRecord } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

/**
 * Best-effort mailbox address for classifying synced mail direction.
 * Prefers a credential `config.fromAddress`, then an explicit fallback
 * (e.g. the IMAP login) the sync host already resolved.
 */
export async function resolveConnectorAccountEmail(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    connectorName: string;
    /** When set, read that credential's config instead of the org default. */
    credentialRef?: string;
    fallbackEmail?: string;
  },
): Promise<string | undefined> {
  const row: unknown = await ctx.runQuery(
    internal.connector_credentials.queries.resolveCredentialRefInternal,
    {
      organizationId: params.organizationId,
      connectorSlug: params.connectorName,
      ...(params.credentialRef !== undefined && {
        credentialRef: params.credentialRef,
      }),
    },
  );
  const config = isRecord(row) && isRecord(row.config) ? row.config : null;
  if (config !== null) {
    const from =
      typeof config.fromAddress === 'string' ? config.fromAddress.trim() : '';
    if (from.includes('@')) return from;
  }
  const fallback = params.fallbackEmail?.trim();
  if (fallback?.includes('@')) return fallback;
  return undefined;
}
