/**
 * Seed the shared Slack App's OAuth2 client credentials onto a per-org
 * slug='slack' credential from deployment env vars.
 *
 * The platform runs ONE Slack App; its client_id / client_secret live in
 * `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` (configured once per deployment).
 * The generic OAuth2 authorize + token-exchange path requires `clientId` (and
 * the exchange requires `clientSecretEncrypted`) on the credential row, so we
 * seed them at connect time rather than asking every admin to paste the same
 * shared values. Idempotent — skips when already populated.
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { saveOAuth2ClientCredentials } from './save_oauth2_client_credentials';

interface ExistingOAuth2Config {
  clientId?: string;
  clientSecretEncrypted?: string;
}

export async function seedSlackOAuth2Config(
  ctx: ActionCtx,
  args: {
    credentialId: Id<'integrationCredentials'>;
    organizationId: string;
    existingOAuth2Config?: ExistingOAuth2Config;
  },
): Promise<void> {
  // Already seeded (or manually configured) — leave it untouched.
  if (
    args.existingOAuth2Config?.clientId &&
    args.existingOAuth2Config?.clientSecretEncrypted
  ) {
    return;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Slack is not configured on this deployment. Set SLACK_CLIENT_ID, ' +
        'SLACK_CLIENT_SECRET, and SLACK_SIGNING_SECRET before connecting Slack.',
    );
  }

  const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
  const fileResult = await ctx.runAction(
    internal.integrations.file_actions.readIntegrationForExecution,
    { orgSlug, slug: 'slack' },
  );
  const fileOAuth2Config = fileResult?.ok
    ? fileResult.config?.oauth2Config
    : undefined;
  if (!fileOAuth2Config?.authorizationUrl || !fileOAuth2Config?.tokenUrl) {
    throw new Error(
      'Slack integration file config is missing oauth2Config (authorizationUrl/tokenUrl).',
    );
  }

  await saveOAuth2ClientCredentials(ctx, {
    credentialId: args.credentialId,
    authorizationUrl: fileOAuth2Config.authorizationUrl,
    tokenUrl: fileOAuth2Config.tokenUrl,
    scopes: fileOAuth2Config.scopes,
    clientId,
    clientSecret,
  });
}
