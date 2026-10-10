/**
 * The platform's native connector backends, and the one call that installs
 * them.
 *
 * Six shipped actions declare `backend: { kind: native }` because they speak
 * something HTTP cannot: IMAP and SMTP are raw-TCP sessions, and the WebDAV
 * actions act on the organization's own file store rather than on any vendor
 * API. Until a native is registered the dispatcher refuses those actions
 * loudly — a caller that asked for a real send must never be handed a
 * fabricated success — so registration is the whole point of this module.
 *
 * Everything the natives depend on is injected: the document store the WebDAV
 * actions act through, and the transports the mail actions open. A host wires
 * the real implementations once, at the same place it installs the connector
 * catalog; tests wire doubles and need neither a network nor a database.
 */

import { registerNativeImpl } from '../dispatcher';
import { httpNatives, type HttpNativeDeps } from './http';
import {
  imapSmtpNatives,
  nodeMailTransport,
  type MailAttachmentResolver,
  type MailboxConfigResolver,
  type MailTransport,
} from './imap-smtp';
import { issueImportNatives } from './issue-import';
import {
  platformConversationNatives,
  type WorkflowConversationStore,
} from './platform-conversations';
import {
  platformDocumentNatives,
  type WorkflowDocumentStore,
} from './platform-documents';
import {
  knowledgeNatives,
  type WorkflowKnowledgeSearch,
} from './platform-knowledge';
import { platformTaskNatives, type WorkflowTaskStore } from './platform-tasks';
import {
  sandboxScriptNatives,
  type SandboxScriptRunner,
} from './sandbox-script';
import { webdavNatives, type WebdavStore } from './webdav';

export {
  type ImapSession,
  type ListedMailbox,
  type MailAttachmentResolver,
  type MailboxConfig,
  type MailboxConfigResolver,
  type MailboxQuery,
  type MailboxSelector,
  type MailMessageSummary,
  type MailTransport,
  type OutboundMail,
  type SmtpSession,
} from './imap-smtp';
export {
  WebdavStoreError,
  type WebdavEntry,
  type WebdavFileBytes,
  type WebdavStore,
  type WebdavStoreErrorCode,
} from './webdav';
export { type OrgPath } from './webdav-paths';
export {
  type SandboxScriptOutcome,
  type SandboxScriptRun,
  type SandboxScriptRunner,
} from './sandbox-script';
export {
  type WorkflowAgentStart,
  type WorkflowTaskComment,
  type WorkflowTaskStore,
  type WorkflowTaskView,
} from './platform-tasks';
export {
  type ConversationIngestResult,
  type ConversationSyncCursor,
  type ConversationSyncResult,
  type WorkflowConversationStore,
} from './platform-conversations';
export {
  type WorkflowDocumentStore,
  type WorkflowFolderFile,
} from './platform-documents';
export {
  type KnowledgeRunHit,
  type KnowledgeRunRefusal,
  type WorkflowKnowledgeSearch,
} from './platform-knowledge';

/**
 * What the natives need from the platform.
 *
 * `webdav` is required: the WebDAV actions have nothing to act on without the
 * organization's document store, and defaulting it to something local would be
 * a second, unpoliced path to org files. The mail transport defaults to the
 * real IMAP/SMTP clients, which load only when a mailbox is actually opened.
 */
export interface NativeConnectorDeps {
  readonly webdav: WebdavStore;
  /** The sandbox script runner — required for the same reason the store is:
   * `sandbox.run_script` has nothing to act through without it, and a
   * default would be a second, unpoliced door into org sandboxes. */
  readonly sandboxScripts: SandboxScriptRunner;
  /** The task and document domains — same rationale: platform capabilities
   * act on org data only through the domain's own internal functions. */
  readonly tasks: WorkflowTaskStore;
  readonly documents: WorkflowDocumentStore;
  readonly conversations: WorkflowConversationStore;
  /** The knowledge domain's search, as an automation run — same rationale:
   * what a run reads and whose spend it is come from the run itself. */
  readonly knowledge: WorkflowKnowledgeSearch;
  /** Outbound mail attachment bytes, by org-scoped blob ref — required for
   * the same reason: the mail native must never read a file or a URL a
   * caller names, so the org's blob store is its only source of bytes. */
  readonly mailAttachments: MailAttachmentResolver;
  readonly mailTransport?: MailTransport;
  readonly mailConfig?: MailboxConfigResolver;
  /** The HTTP connector's lane and outbound client. A host leaves the
   * budget out only where nothing outside a test calls an API. */
  readonly http?: HttpNativeDeps;
}

/** The impl ids the shipped native actions declare — the contract this
 * module fulfils, and what a wiring test asserts against. */
export const NATIVE_IMPL_IDS = [
  'conversation.ingest_emails',
  'conversation.ingest_sent_emails',
  'conversation.list_mailbox_messages',
  'conversation.list_untriaged',
  'conversation.query_sync_cursor',
  'conversation.record_triage',
  'conversation.sync_mailbox',
  'document.create',
  'document.list',
  'github.get_import_issue',
  'github.list_import_issues',
  'github.refresh_import_issues',
  'glitchtip.get_import_issue',
  'glitchtip.list_import_issues',
  'glitchtip.refresh_import_issues',
  'http.get',
  'http.send',
  'imap-smtp.list_messages',
  'imap-smtp.get_message',
  'imap-smtp.send',
  'knowledge.search',
  'sandbox.run_script',
  'task.comment',
  'task.get',
  'task.get_import_cursor',
  'task.list_comments',
  'task.list_external_issues',
  'task.save_import_cursor',
  'task.start_agent',
  'task.update_status',
  'task.upsert',
  'task.upsert_issues',
  'webdav.delete',
  'webdav.list',
  'webdav.read',
  'webdav.write',
] as const;

/**
 * Register every native backend the shipped catalog declares.
 *
 * Idempotent: registering again replaces the previous implementations, which is
 * what lets a host rebuild the dependencies per invocation (the document store
 * is bound to the request context) without leaving a stale one installed.
 * Returns a disposer that removes exactly the implementations this call added.
 */
export function registerNativeConnectors(
  deps: NativeConnectorDeps,
): () => void {
  const impls = {
    ...issueImportNatives(),
    ...httpNatives(deps.http ?? {}),
    ...imapSmtpNatives({
      transport: deps.mailTransport ?? nodeMailTransport(),
      resolveAttachment: deps.mailAttachments,
      ...(deps.mailConfig !== undefined && { resolveConfig: deps.mailConfig }),
    }),
    ...knowledgeNatives(deps.knowledge),
    ...platformConversationNatives(deps.conversations),
    ...platformDocumentNatives(deps.documents),
    ...platformTaskNatives(deps.tasks),
    ...sandboxScriptNatives(deps.sandboxScripts),
    ...webdavNatives(deps.webdav),
  };

  const missing = NATIVE_IMPL_IDS.filter((id) => !(id in impls));
  if (missing.length > 0) {
    // A native the catalog declares but this module does not build would fail
    // at dispatch time with "not available". Failing here — before anything is
    // installed — names the gap while there is still a stack trace worth
    // reading, and leaves no half-registered set behind.
    throw new Error(
      `[connectors] native backends missing from the registration set: ${missing.join(', ')}`,
    );
  }

  const disposers = Object.entries(impls).map(([id, impl]) =>
    registerNativeImpl(id, impl),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
