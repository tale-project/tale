/** Why a connection ended, as the list says it. */
export type AgentConnectionEndReason =
  | 'user'
  | 'admin'
  | 'membership_ended'
  | 'account_security'
  | 'refresh_reuse'
  | 'client_removed';

/** One coding agent as `GET /api/app/agent-connections` lists it. */
export interface AgentConnection {
  id: string;
  userId: string;
  /** The app's name, cleaned for display on the server. */
  clientName: string;
  /** `metadata_document`: the app proved who it is by its own domain
   * (`clientHost`); `registered`: it registered itself and chose its own
   * name. */
  provenance: 'metadata_document' | 'registered';
  clientHost: string | null;
  /** The access the person gave, as OAuth scopes. */
  scopes: string[];
  /** Epoch milliseconds. */
  createdAt: number;
  /** When the agent last called, from the endpoint's own counters; null
   * before its first call. */
  lastUsedAt: number | null;
  /** Epoch milliseconds; null while the connection lives. */
  revokedAt: number | null;
  revokeReason: AgentConnectionEndReason | null;
  /** Who connected it — the account's name and address. */
  personName: string | null;
  personEmail: string | null;
}

/** Which connections the list asks for: the signed-in person's own or — for
 * an owner or admin — everyone's, with or without the ended ones. */
export interface AgentConnectionsView {
  scope: 'mine' | 'everyone';
  ended: boolean;
}

export interface AgentConnectionList {
  connections: AgentConnection[];
  /** Whether the caller is an owner or admin, who may ask for everyone's. */
  canSeeEveryone: boolean;
}

/** What the signed-in person has to do with coding agents in an
 * organization (`GET /api/app/agent-connections/access`). */
export interface AgentConnectionAccess {
  mayConnect: boolean;
  holdsConnection: boolean;
  /** Whether the deployment lets coding agents sign in at all. Until it
   * does, nothing offers a way to connect one. */
  signInOn: boolean;
}
