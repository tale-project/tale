/**
 * What a connector OAuth consent is FOR, from the click that starts it to the
 * callback that stores it:
 *
 *   `add`        Add credential > <connector> > Connect: store a NEW
 *                credential, whatever the organization already holds.
 *   `reconnect`  a credential row's Reconnect: renew exactly `credentialId`,
 *                keeping its name, default flag and references.
 *
 * The start door reads the intent from one query parameter — absent is an
 * Add, so a link that predates the parameter can never overwrite a
 * credential — and the pending authorization carries it server-side; the
 * callback request never names it. The page that writes the parameter and the
 * door that reads it share this module, so the two cannot drift apart into a
 * Reconnect that silently lands as an Add. Layer A — no imports.
 */
export type ConsentIntent =
  | { kind: 'add' }
  | { kind: 'reconnect'; credentialId: string };

/** The start door's query parameter naming the credential a Reconnect renews. */
export const RECONNECT_CREDENTIAL_PARAM = 'credentialId';
