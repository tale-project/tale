/**
 * Whether the org's Inbox (the conversations surface) is available, and which
 * installed inbox automations feed it.
 *
 * The real signal — "at least one installed automation declares the `inbox`
 * builtin view" — lived in the automations registry, which is offline while
 * the automations backend is rebuilt. Conversations data itself (the email
 * threads in Convex) is alive and must stay reachable, so this stand-in
 * reports the Inbox as available for every org and an empty automation list:
 * the nav entry stays visible, existing conversations stay readable, and the
 * automation-derived affordances (channel filter options, compose providers)
 * degrade to their empty states. The automation-backed signal returns with
 * the automations rebuild.
 */
export interface InboxAutomationSummary {
  slug: string;
  /** The first entry is the inbox provider (gmail / outlook / imap_smtp). */
  requiredConnectors: string[];
}

export function useInboxAvailability(_organizationId: string): {
  isLoading: boolean;
  hasInbox: boolean;
  inboxAutomations: InboxAutomationSummary[];
} {
  return { isLoading: false, hasInbox: true, inboxAutomations: [] };
}
