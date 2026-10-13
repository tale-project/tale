import type { Sql } from 'postgres';

import { displayClientName } from '../../../lib/shared/client-name.ts';
import type { AgentClientProvenance } from './service.ts';

/**
 * Who an app is, as the consent page shows it and the connection records it.
 * One reading for both, so the page never shows an identity the record would
 * not keep: the name the app gave itself, made safe to show, and whether the
 * app proved who it is (a metadata document on its own HTTPS host) or merely
 * registered itself.
 */

/** What the sign-in server keeps of an app that this reads. */
interface AgentClientRow {
  name: string | null;
  discovery: string | null;
}

export interface AgentClientIdentity {
  /** The name to show: sanitized, never empty. */
  name: string;
  provenance: AgentClientProvenance;
  /** The verified host of a metadata document; null for an app that
   * registered itself, whose identity nobody vouched for. */
  host: string | null;
}

/** The sign-in server's row for an app, or null when it knows no such app. */
export async function readAgentClientRow(
  sql: Sql,
  clientId: string,
): Promise<AgentClientRow | null> {
  const rows = await sql<AgentClientRow[]>`
    SELECT "name", "clientDiscoveryId" AS "discovery" FROM "oauthClient"
    WHERE "clientId" = ${clientId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * The identity of an app from its id and its row. An app that identifies
 * itself by a metadata document has that document's address for an id, and
 * the host of it is the host the document was fetched from; any other app
 * is unverified. A name that names nothing falls back to the host, and then
 * to "App".
 */
export function agentClientIdentity(
  clientId: string,
  row: AgentClientRow | null,
): AgentClientIdentity {
  const provenance: AgentClientProvenance =
    row?.discovery === 'cimd' ? 'metadata_document' : 'registered';
  const host =
    provenance === 'metadata_document' && URL.canParse(clientId)
      ? new URL(clientId).hostname
      : null;
  return {
    name:
      displayClientName(row?.name) ??
      (URL.canParse(clientId) ? new URL(clientId).hostname : 'App'),
    provenance,
    host,
  };
}
