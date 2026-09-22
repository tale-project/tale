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
 * The reply follows the thread: the server re-derives the route from these
 * same stamps, so what this module names is also where a reply will leave
 * from. It is the caller's job to supply connector titles; this module never
 * queries.
 */

/** The lane a thread is on. `unknown` is a thread stamped before either
 *  field was written, which can still be read but has no reply route. */
export type ChannelLane = 'api' | 'email' | 'unknown';

export interface ChannelSource {
  lane: ChannelLane;
  /** The connector or source slug, when the thread names one. */
  slug?: string;
  /** What to show: a connector's title ("Gmail"), else the bare slug. */
  label?: string;
}

export interface ConversationSourceInput {
  channel?: string;
  connectorName?: string;
}

/**
 * Resolve a thread's source for display.
 *
 * `titleOf` names an email connector; an API source has no catalog entry, so
 * its own slug is the honest label. A thread with neither stamp resolves to
 * `unknown` with no label rather than inventing one — the Inbox says nothing
 * instead of saying something wrong.
 */
export function channelSourceOf(
  conversation: ConversationSourceInput,
  titleOf: (slug: string) => string | undefined,
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
  return { lane: 'email', slug, label: titleOf(slug) ?? slug };
}
