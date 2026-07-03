/**
 * IMAP/SMTP Integration Execution Helper
 *
 * Handles execution of imap_smtp integration operations invoked through the
 * unified integration action (i.e. the sync workflow). Reading runs here;
 * sending replies is handled by the dedicated conversation send path
 * (`conversations/internal_actions.sendMessageViaIntegrationAction`), so this
 * helper intentionally supports only the read/sync operations.
 */

import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import { resolveImapSmtpConnection } from '../../../../integrations/imap_smtp_config';
import type { LoadedIntegration } from '../../../../integrations/load_integration';
import { createDebugLog } from '../../../../lib/debug_log';
import { redactSecrets } from './redact_secrets';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

/** Operations that map to an IMAP fetch. */
const FETCH_OPERATIONS = new Set(['list_messages', 'fetch_messages']);

export interface ImapSmtpExecutionResult {
  name: string;
  operation: string;
  result: { data: unknown };
  duration: number;
}

export async function executeImapSmtpIntegration(
  ctx: ActionCtx,
  integration: LoadedIntegration,
  operation: string,
  params: Record<string, unknown>,
): Promise<ImapSmtpExecutionResult> {
  if (!FETCH_OPERATIONS.has(operation)) {
    throw new Error(
      `Operation "${operation}" is not supported for imap_smtp integration "${integration.name}" via the integration action. ` +
        `Supported operations: ${[...FETCH_OPERATIONS].join(', ')}. ` +
        `Sending is handled through the conversation reply flow.`,
    );
  }

  const connection = await resolveImapSmtpConnection(ctx, integration);

  const since = typeof params.since === 'number' ? params.since : undefined;
  const maxResults =
    typeof params.maxResults === 'number' ? params.maxResults : undefined;
  const mailbox =
    typeof params.mailbox === 'string' ? params.mailbox : undefined;

  debugLog(
    `Fetching IMAP messages for ${integration.name} from ${connection.imap.host}:${connection.imap.port} (since: ${since ?? 'all'})`,
  );

  const result = await ctx.runAction(
    internal.node_only.imap_smtp.internal_actions.fetchMessages,
    {
      imap: connection.imap,
      mailbox,
      since,
      maxResults,
    },
  );

  if (!result.success) {
    // The driver error can echo the host / credentials; redact before it
    // propagates into the workflow surface.
    throw new Error(
      `IMAP fetch failed: ${redactSecrets(result.error ?? '', {
        password: connection.imap.password,
        username: connection.imap.user,
      })}`,
    );
  }

  debugLog(
    `IMAP fetch returned ${result.data?.length ?? 0} messages in ${result.duration ?? 0}ms`,
  );

  return {
    name: integration.name,
    operation,
    // Shape matches the gmail sync workflow contract: result.data is an
    // EmailType[] consumed by conversation.create_from_email.
    result: { data: result.data ?? [] },
    duration: result.duration ?? 0,
  };
}
