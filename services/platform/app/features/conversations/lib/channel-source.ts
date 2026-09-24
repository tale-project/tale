/**
 * Where a conversation came in, and where a reply goes back out.
 *
 * A thread carries two provenance stamps: `channel` says WHICH LANE it is on
 * (`email`, or `api` for a thread an integration synced through
 * `/api/v1/conversations/sync`), and `connectorName` says which connector or
 * source inside that lane. The two namespaces are disjoint — an email thread
 * names a connector catalog slug (`gmail`), an API thread names whatever
 * source slug the caller chose — so neither field alone identifies the lane.
 *
 * Inside the email lane one connector can hold several mailboxes (one
 * credential each), so the connector does not say which mailbox a thread is
 * on. The server does: it resolves each thread's `credentialId` with the same
 * rule its reply route uses, so the mailbox this module names is also where a
 * reply will leave from. It is the caller's job to supply the organization's
 * mailboxes; this module never queries.
 */

import { configuredFromAddress } from './email-connectors';

/** The lane a thread is on. `unknown` is a thread stamped before either
 *  field was written, which can still be read but has no reply route. */
export type ChannelLane = 'api' | 'email' | 'unknown';

/** One of the organization's mailboxes: a connector credential. */
export interface MailboxEntry {
  id: string;
  connectorSlug: string;
  name: string;
  status: string;
  config?: Record<string, string | number | boolean>;
}

/** The mailbox a thread is on. */
export interface ChannelMailbox {
  id: string;
  name: string;
  /** The mailbox's configured send address, when it exposes one. */
  fromAddress?: string;
}

export interface ChannelSource {
  lane: ChannelLane;
  /** The connector or source slug, when the thread names one. */
  slug?: string;
  /** What to show: the mailbox's name ("General Support"), else the bare
   *  slug. */
  label?: string;
  /** The email thread's mailbox, when it is known. */
  mailbox?: ChannelMailbox;
}

export interface ConversationSourceInput {
  channel?: string;
  connectorName?: string;
  credentialId?: string;
}

function mailboxOf(entry: MailboxEntry): ChannelMailbox {
  const fromAddress = configuredFromAddress(entry.config);
  return {
    id: entry.id,
    name: entry.name,
    ...(fromAddress !== undefined ? { fromAddress } : {}),
  };
}

/**
 * Resolve a thread's source for display.
 *
 * An email thread names the mailbox the server placed it on, even one since
 * disabled — it is still where the thread arrived. A thread the server could
 * not place is named only when its connector has a single active mailbox, so
 * there is nothing to confuse it with; otherwise it names no mailbox and the
 * label is the bare slug. An API source has no mailbox, so its own slug is
 * the honest label. A thread with neither stamp resolves to `unknown` with no
 * label rather than inventing one — the Inbox says nothing instead of saying
 * something wrong.
 */
export function channelSourceOf(
  conversation: ConversationSourceInput,
  mailboxes: readonly MailboxEntry[],
): ChannelSource {
  const slug =
    typeof conversation.connectorName === 'string' &&
    conversation.connectorName !== ''
      ? conversation.connectorName
      : undefined;

  if (conversation.channel === 'api') {
    return { lane: 'api', ...(slug ? { slug, label: slug } : {}) };
  }
  if (slug === undefined) return { lane: 'unknown' };

  const placed =
    conversation.credentialId !== undefined
      ? mailboxes.find(
          (entry) =>
            entry.id === conversation.credentialId &&
            entry.connectorSlug === slug,
        )
      : undefined;
  const active = mailboxes.filter(
    (entry) => entry.connectorSlug === slug && entry.status === 'active',
  );
  const entry = placed ?? (active.length === 1 ? active[0] : undefined);
  if (entry === undefined) return { lane: 'email', slug, label: slug };
  const mailbox = mailboxOf(entry);
  return { lane: 'email', slug, label: mailbox.name, mailbox };
}

export interface ChannelOption {
  /** What the server filters on: `connectorName`. */
  value: string;
  label: string;
}

/**
 * Every lane a thread can arrive on, for the Inbox's channel facet.
 *
 * Email connectors are named by their title. An API source names itself —
 * the integration chose the slug and there is no catalog to read it from.
 * A source that collides with a connector slug is dropped rather than
 * listed twice: one slug is one lane on the server's filter.
 */
export function channelOptionsOf(
  connectors: ReadonlyArray<{ slug: string; title: string }>,
  apiSources: readonly string[],
): ChannelOption[] {
  // One entry per connector: the list may hold several mailboxes on one.
  const options: ChannelOption[] = [];
  const seen = new Set<string>();
  for (const connector of connectors) {
    if (seen.has(connector.slug)) continue;
    seen.add(connector.slug);
    options.push({ value: connector.slug, label: connector.title });
  }
  for (const source of apiSources) {
    if (seen.has(source)) continue;
    seen.add(source);
    options.push({ value: source, label: source });
  }
  return options;
}
