import { describe, expect, it } from 'vitest';

import { watchConnections } from './connection-watch';

const connection = (id: string, clientName: string, createdAt: number) => ({
  id,
  clientName,
  createdAt,
});

describe('watchConnections', () => {
  it('waits while the connections are the ones that were there', () => {
    expect(
      watchConnections(new Set(['a', 'b']), [
        connection('a', 'Claude Code', 1),
        connection('b', 'Codex', 2),
      ]),
    ).toEqual({ state: 'waiting' });
  });

  it('waits when there are none', () => {
    expect(watchConnections(new Set(), [])).toEqual({ state: 'waiting' });
  });

  it('is connected once one appears that was not there before', () => {
    expect(
      watchConnections(new Set(['a']), [
        connection('a', 'Claude Code', 1),
        connection('b', 'Codex', 5),
      ]),
    ).toEqual({ state: 'connected', clientName: 'Codex' });
  });

  it('names the newest when several appeared', () => {
    expect(
      watchConnections(new Set(), [
        connection('a', 'Cursor', 3),
        connection('b', 'Codex', 9),
        connection('c', 'Claude Code', 5),
      ]),
    ).toEqual({ state: 'connected', clientName: 'Codex' });
  });

  it('does not take an agent connected earlier for the one being set up', () => {
    // Opening the dialog on a page that already lists an agent.
    expect(
      watchConnections(new Set(['old']), [connection('old', 'Cursor', 1)]),
    ).toEqual({ state: 'waiting' });
  });
});
