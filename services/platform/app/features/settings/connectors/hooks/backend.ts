import type { ItemOf } from '@/app/lib/backend/contract';

/**
 * Backend bindings of the connectors settings page.
 *
 * Both shapes are derived from the Convex functions themselves, so the page
 * cannot drift from what the server actually returns — a field renamed on a
 * validator becomes a type error here instead of an `undefined` on screen.
 *
 * The catalog used to be bound BY NAME through `makeFunctionReference`, beside
 * a hand-written interface, because no public listing existed yet. One does now,
 * and a string-bound call is exactly the kind that compiles clean and fails only
 * at runtime — so the escape hatch is gone.
 */

/** One stored credential as the settings listing sees it: metadata plus the
 * write-time masked preview. Secret material never leaves the server. */
export type MaskedConnectorCredential =
  ItemOf<'connector_credentials/queries:listCredentials'>;

/** One shipped connector as the catalog lists it: its icon, tags, and how many
 * actions it exposes to automations and chat. */
export type ConnectorSummary =
  ItemOf<'connector_credentials/connector_catalog:listConnectors'>;
