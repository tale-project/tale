/**
 * Mail connectors that can deliver actionable notification email.
 * Shared between the V8 credential listing query and the Node send helpers.
 */

export const ACTIONABLE_EMAIL_CONNECTORS = [
  'imap-smtp',
  'gmail',
  'outlook',
] as const;

export type ActionableEmailConnectorSlug =
  (typeof ACTIONABLE_EMAIL_CONNECTORS)[number];
