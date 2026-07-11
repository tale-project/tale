// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { resolvePendingThreadGateStatus } from './chat';

// #2658 regression: opening an archived chat briefly painted the active
// composer before flipping to the archived footer once `getThreadStatus`
// resolved. `ThreadGate` now seeds an early "archived" guess from the
// already-loaded archived-threads list while `getThreadStatus` is still
// resolving, and holds a neutral (neither) footer when even that seed hasn't
// resolved yet — the deep-link / cold-load case, where nothing has had a
// chance to warm the archived-threads cache. `resolvePendingThreadGateStatus`
// is the pure decision `ThreadGate` delegates to; covered directly so the
// seed-match / neutral-hold / fall-through branches don't need the full
// Convex + router + chat-layout provider tree mounted.
describe('resolvePendingThreadGateStatus', () => {
  it('seeds "archived" when the thread id is in the already-loaded archived list', () => {
    expect(
      resolvePendingThreadGateStatus({
        threadId: 'thread-archived',
        archivedThreadIds: new Set(['thread-archived', 'thread-other']),
      }),
    ).toEqual({ status: 'archived', statusPending: false });
  });

  it('falls through to the optimistic composer when the list has resolved and excludes the thread', () => {
    expect(
      resolvePendingThreadGateStatus({
        threadId: 'thread-active',
        archivedThreadIds: new Set(['thread-other']),
      }),
    ).toEqual({ status: undefined, statusPending: false });
  });

  // Deep-link / cold session start: the archived-threads list has not
  // resolved even once yet (unlike a sidebar click, where it's already warm),
  // so there is no seed to trust either way — hold a neutral footer instead
  // of guessing "not archived", which is exactly the flash this fix removes.
  it('holds a neutral footer when the archived-threads seed has not resolved yet (deep link)', () => {
    expect(
      resolvePendingThreadGateStatus({
        threadId: 'thread-archived',
        archivedThreadIds: undefined,
      }),
    ).toEqual({ status: undefined, statusPending: true });
  });

  it('does not hold pending once the (empty) list has resolved for a thread not present in it', () => {
    expect(
      resolvePendingThreadGateStatus({
        threadId: 'thread-active',
        archivedThreadIds: new Set(),
      }),
    ).toEqual({ status: undefined, statusPending: false });
  });

  it('falls through when there is no threadId yet (new-chat route)', () => {
    expect(
      resolvePendingThreadGateStatus({
        threadId: undefined,
        archivedThreadIds: new Set(['thread-archived']),
      }),
    ).toEqual({ status: undefined, statusPending: false });
  });
});
