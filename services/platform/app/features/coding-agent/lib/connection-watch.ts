/**
 * Whether an agent signed in while the setup dialog was open. A connection
 * counts as new when it was not among the ones that existed when the dialog
 * opened: an agent connected earlier says nothing about the one being set up.
 */

export interface WatchedConnection {
  readonly id: string;
  readonly clientName: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

export type ConnectionWatch =
  | { readonly state: 'waiting' }
  | { readonly state: 'connected'; readonly clientName: string };

/** The newest connection that is not in `before`, if there is one. */
export function watchConnections(
  before: ReadonlySet<string>,
  connections: readonly WatchedConnection[],
): ConnectionWatch {
  let newest: WatchedConnection | undefined;
  for (const connection of connections) {
    if (before.has(connection.id)) continue;
    if (newest === undefined || connection.createdAt > newest.createdAt) {
      newest = connection;
    }
  }
  return newest === undefined
    ? { state: 'waiting' }
    : { state: 'connected', clientName: newest.clientName };
}
