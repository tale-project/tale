import { describe, expect, it } from 'vitest';

import { baselineOf, watchConnections } from './connection-watch';

const connection = (id: string, clientName: string, updatedAt: number) => ({
  id,
  clientName,
  updatedAt,
});

describe('watchConnections', () => {
  it('waits while the connections are the ones that were there, untouched', () => {
    const before = baselineOf([
      connection('a', 'Claude Code', 1),
      connection('b', 'Codex', 2),
    ]);
    expect(
      watchConnections(before, [
        connection('a', 'Claude Code', 1),
        connection('b', 'Codex', 2),
      ]),
    ).toEqual({ state: 'waiting' });
  });

  it('waits when there are none', () => {
    expect(watchConnections(baselineOf([]), [])).toEqual({ state: 'waiting' });
  });

  it('is connected once one appears that was not there before', () => {
    const before = baselineOf([connection('a', 'Claude Code', 1)]);
    expect(
      watchConnections(before, [
        connection('a', 'Claude Code', 1),
        connection('b', 'Codex', 5),
      ]),
    ).toEqual({ state: 'connected', clientName: 'Codex' });
  });

  it('is connected when an agent that was connected before signs in again', () => {
    // Allowing an app that is already connected changes the same connection:
    // its id is the one that was there, its `updatedAt` is what moved.
    const before = baselineOf([connection('a', 'Claude Code', 1)]);
    expect(
      watchConnections(before, [connection('a', 'Claude Code', 9)]),
    ).toEqual({ state: 'connected', clientName: 'Claude Code' });
  });

  it('names the one allowed last when several signed in', () => {
    const before = baselineOf([connection('a', 'Cursor', 1)]);
    expect(
      watchConnections(before, [
        connection('a', 'Cursor', 3),
        connection('b', 'Codex', 9),
        connection('c', 'Claude Code', 5),
      ]),
    ).toEqual({ state: 'connected', clientName: 'Codex' });
  });

  it('does not take an agent connected earlier for the one being set up', () => {
    // Opening the dialog on a page that already lists an agent.
    expect(
      watchConnections(baselineOf([connection('old', 'Cursor', 1)]), [
        connection('old', 'Cursor', 1),
      ]),
    ).toEqual({ state: 'waiting' });
  });

  it('compares only what the server wrote, so a value that went back does not count', () => {
    const before = baselineOf([connection('a', 'Cursor', 8)]);
    expect(watchConnections(before, [connection('a', 'Cursor', 5)])).toEqual({
      state: 'waiting',
    });
  });
});
