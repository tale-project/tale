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

import { registerNativeImpl, nativeImplIds } from '../dispatcher';
import {
  imapSmtpNatives,
  nodeMailTransport,
  type MailboxConfigResolver,
  type MailTransport,
} from './imap-smtp';
import {
  platformDocumentNatives,
  type WorkflowDocumentStore,
} from './platform-documents';
import { platformTaskNatives, type WorkflowTaskStore } from './platform-tasks';
import {
  sandboxScriptNatives,
  type SandboxScriptRunner,
} from './sandbox-script';
import { webdavNatives, type WebdavStore } from './webdav';

export {
  discoverSentMailbox,
  imapSmtpNatives,
  mailboxConfigFromCredential,
  nodeMailTransport,
  selectMailbox,
  type ImapSession,
  type ListedMailbox,
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
  webdavNatives,
  WebdavStoreError,
  type WebdavEntry,
  type WebdavFileBytes,
  type WebdavStore,
  type WebdavStoreErrorCode,
} from './webdav';
export {
  formatChildPath,
  formatOrgPath,
  parseOrgPath,
  type OrgPath,
} from './webdav-paths';
export {
  sandboxScriptNatives,
  type SandboxScriptOutcome,
  type SandboxScriptRun,
  type SandboxScriptRunner,
} from './sandbox-script';
export {
  platformTaskNatives,
  type WorkflowTaskComment,
  type WorkflowTaskStore,
  type WorkflowTaskView,
} from './platform-tasks';
export {
  platformDocumentNatives,
  type WorkflowDocumentStore,
  type WorkflowFolderFile,
} from './platform-documents';

/**
 * What the natives need from the platform.
 *
 * `webdav` is required: the WebDAV actions have nothing to act on without the
 * organization's document store, and defaulting it to something local would be
 * a second, unpoliced path to org files. The mail transport defaults to the
 * real IMAP/SMTP clients, which load only when a mailbox is actually opened.
 */
export interface NativeIntegrationDeps {
  readonly webdav: WebdavStore;
  /** The sandbox script runner — required for the same reason the store is:
   * `sandbox.run_script` has nothing to act through without it, and a
   * default would be a second, unpoliced door into org sandboxes. */
  readonly sandboxScripts: SandboxScriptRunner;
  /** The task and document domains — same rationale: platform capabilities
   * act on org data only through the domain's own internal functions. */
  readonly tasks: WorkflowTaskStore;
  readonly documents: WorkflowDocumentStore;
  readonly mailTransport?: MailTransport;
  readonly mailConfig?: MailboxConfigResolver;
}

/** The impl ids the six shipped native actions declare — the contract this
 * module fulfils, and what a wiring test asserts against. */
export const NATIVE_IMPL_IDS = [
  'document.create',
  'document.list',
  'imap-smtp.list_messages',
  'imap-smtp.send',
  'sandbox.run_script',
  'task.comment',
  'task.get',
  'task.list_comments',
  'task.update_status',
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
export function registerNativeIntegrations(
  deps: NativeIntegrationDeps,
): () => void {
  const impls = {
    ...imapSmtpNatives({
      transport: deps.mailTransport ?? nodeMailTransport(),
      ...(deps.mailConfig !== undefined && { resolveConfig: deps.mailConfig }),
    }),
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
      `[integrations] native backends missing from the registration set: ${missing.join(', ')}`,
    );
  }

  const disposers = Object.entries(impls).map(([id, impl]) =>
    registerNativeImpl(id, impl),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** The native backends currently installed — re-exported so a host can log
 * what it wired without importing the dispatcher's registry directly. */
export { nativeImplIds };
