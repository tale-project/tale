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
import { resolveImapMailbox } from '../../../../integrations/resolve_imap_mailbox';
import { createDebugLog } from '../../../../lib/debug_log';
import type { EmailType } from '../../conversation/helpers/types';
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
  const mailboxParam =
    typeof params.mailbox === 'string' ? params.mailbox : undefined;
  const connectionConfig =
    integration.connectionConfig &&
    typeof integration.connectionConfig === 'object' &&
    !Array.isArray(integration.connectionConfig)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connectionConfig is v.any() with catchall keys
        (integration.connectionConfig as Record<string, unknown>)
      : undefined;
  const { mailbox, isSentFolder } = resolveImapMailbox(
    connectionConfig,
    mailboxParam,
  );
  const isSentSync =
    isSentFolder ||
    (typeof mailboxParam === 'string' &&
      mailboxParam.trim().toLowerCase() === 'sent');

  debugLog(
    `Fetching IMAP messages for ${integration.name} from ${connection.imap.host}:${connection.imap.port} mailbox=${mailbox ?? 'INBOX'} sentSync=${isSentSync} (since: ${since ?? 'all'})`,
  );

  let result: {
    success: boolean;
    data?: EmailType[];
    error?: string;
    warning?: string;
    duration?: number;
  };

  try {
    result = await ctx.runAction(
      internal.node_only.imap_smtp.internal_actions.fetchMessages,
      {
        imap: connection.imap,
        mailbox,
        sentFolder: isSentSync,
        since,
        maxResults,
      },
    );
  } catch (error) {
    if (isSentSync) {
      debugLog(
        `Sent folder fetch threw for ${integration.name}, skipping sent sync:`,
        error,
      );
      return {
        name: integration.name,
        operation,
        result: { data: [] },
        duration: 0,
      };
    }
    throw error;
  }

  if (!result.success) {
    if (isSentSync) {
      debugLog(
        `Sent folder fetch failed for ${integration.name}, skipping sent sync:`,
        result.error,
      );
      return {
        name: integration.name,
        operation,
        result: { data: [] },
        duration: result.duration ?? 0,
      };
    }

    // The driver error can echo the host / credentials; redact before it
    // propagates into the workflow surface.
    throw new Error(
      `IMAP fetch failed: ${redactSecrets(result.error ?? '', {
        password: connection.imap.password,
        username: connection.imap.user,
      })}`,
    );
  }

  if (result.warning) {
    debugLog(`IMAP fetch notice for ${integration.name}:`, result.warning);
  }

  debugLog(
    `IMAP fetch returned ${result.data?.length ?? 0} messages in ${result.duration ?? 0}ms`,
  );

  // Sent-sync rows are routed to `create_from_sent_email`, which derives
  // direction from customer/account matching and ignores `email.direction`, so
  // no per-email direction override is applied here.
  const emails = result.data ?? [];

  return {
    name: integration.name,
    operation,
    // Shape matches the gmail sync workflow contract: result.data is an
    // EmailType[] consumed by conversation.create_from_email.
    result: { data: emails },
    duration: result.duration ?? 0,
  };
}
