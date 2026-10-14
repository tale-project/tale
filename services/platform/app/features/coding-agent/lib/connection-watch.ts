/**
 * Whether an agent signed in while the setup dialog was open. A connection
 * counts when it was made, or allowed again, after the dialog opened: the
 * same app signing in a second time changes its one live connection rather
 * than adding another, so its `updatedAt` is what moves, and one that is
 * only listed again, untouched, says nothing about the agent being set up.
 * Only values the server wrote are compared, so a clock that is off cannot
 * make an old connection look new or a new one look old.
 */

export interface WatchedConnection {
  readonly id: string;
  readonly clientName: string;
  /** Epoch milliseconds: when the person last allowed the app. */
  readonly updatedAt: number;
}

/** What was there when the dialog opened: each connection's `updatedAt`. */
export type ConnectionBaseline = ReadonlyMap<string, number>;

export type ConnectionWatch =
  | { readonly state: 'waiting' }
  | { readonly state: 'connected'; readonly clientName: string };

export function baselineOf(
  connections: readonly WatchedConnection[],
): ConnectionBaseline {
  return new Map(
    connections.map((connection) => [connection.id, connection.updatedAt]),
  );
}

/** The connection most recently made or allowed again since the baseline. */
export function watchConnections(
  before: ConnectionBaseline,
  connections: readonly WatchedConnection[],
): ConnectionWatch {
  let newest: WatchedConnection | undefined;
  for (const connection of connections) {
    const known = before.get(connection.id);
    if (known !== undefined && connection.updatedAt <= known) continue;
    if (newest === undefined || connection.updatedAt > newest.updatedAt) {
      newest = connection;
    }
  }
  return newest === undefined
    ? { state: 'waiting' }
    : { state: 'connected', clientName: newest.clientName };
}
