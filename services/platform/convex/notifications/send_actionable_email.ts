'use node';

/**
 * Send helpers for actionable notification email — IMAP/SMTP mailboxes and
 * OAuth connector integrations (Gmail, Outlook).
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { buildIntegrationSecrets } from '../integrations/build_test_secrets';
import { isImapSmtpIntegration } from '../integrations/guards/is_imap_smtp_integration';
import { resolveImapSmtpConnection } from '../integrations/imap_smtp_config';
import type { LoadedIntegration } from '../integrations/load_integration';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';

const CONNECTOR_MAILBOX_SLUGS = new Set(['gmail', 'outlook']);

export type SendableMailbox =
  | { kind: 'smtp'; integration: LoadedIntegration }
  | { kind: 'connector'; integration: LoadedIntegration; slug: string };

function resolveFromAddress(
  integration: LoadedIntegration,
  smtpUser: string,
): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connectionConfig carries mailbox-specific keys
  const connConfig = integration.connectionConfig as
    | Record<string, unknown>
    | undefined;
  if (
    connConfig &&
    typeof connConfig.fromAddress === 'string' &&
    connConfig.fromAddress.trim() !== ''
  ) {
    return connConfig.fromAddress.trim();
  }
  return smtpUser;
}

export async function findSendableMailbox(
  ctx: ActionCtx,
  organizationId: string,
): Promise<SendableMailbox | null> {
  const orgSlug = await resolveOrgSlug(ctx, organizationId);
  const credentials = await ctx.runQuery(
    internal.integrations.credential_queries.listInternal,
    { organizationId },
  );

  let connectorFallback: SendableMailbox | null = null;

  for (const cred of credentials) {
    if (!cred.isActive || cred.status !== 'active') continue;

    const integration = await ctx.runAction(
      internal.integrations.load_integration.loadIntegration,
      {
        orgSlug,
        organizationId,
        slug: cred.slug,
      },
    );
    if (!integration) continue;

    if (isImapSmtpIntegration(integration)) {
      return { kind: 'smtp', integration };
    }

    if (
      CONNECTOR_MAILBOX_SLUGS.has(cred.slug) &&
      integration.connector &&
      !connectorFallback
    ) {
      connectorFallback = {
        kind: 'connector',
        integration,
        slug: cred.slug,
      };
    }
  }

  return connectorFallback;
}

export async function sendActionableEmail(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    mailbox: SendableMailbox;
    to: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<{ success: boolean; error?: string }> {
  if (args.mailbox.kind === 'smtp') {
    const connection = await resolveImapSmtpConnection(
      ctx,
      args.mailbox.integration,
    );
    const from = resolveFromAddress(
      args.mailbox.integration,
      connection.smtp.user,
    );
    const sendResult = await ctx.runAction(
      internal.node_only.imap_smtp.internal_actions.sendMessage,
      {
        smtp: connection.smtp,
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        html: args.html,
      },
    );
    return sendResult.success
      ? { success: true }
      : { success: false, error: sendResult.error };
  }

  const { integration, slug } = args.mailbox;
  const connectorConfig = integration.connector;
  if (!connectorConfig) {
    return { success: false, error: 'missing_connector_config' };
  }

  const secrets = await buildIntegrationSecrets(
    ctx,
    {
      ...integration,
      secretBindings: integration.connector?.secretBindings,
    },
    integration._id,
  );

  const result = await ctx.runAction(
    internal.node_only.integration_sandbox.internal_actions.executeIntegration,
    {
      code: connectorConfig.code,
      operation: 'send_message',
      params: toConvexJsonRecord({
        to: [args.to],
        subject: args.subject,
        body: args.html,
        contentType: 'HTML',
      }),
      variables: {},
      secrets,
      allowedHosts: connectorConfig.allowedHosts ?? [],
      timeoutMs: connectorConfig.timeoutMs ?? 30000,
      organizationId: args.organizationId,
    },
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? `connector_send_failed:${slug}`,
    };
  }
  return { success: true };
}
