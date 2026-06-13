import { describe, expect, it } from 'vitest';

import {
  filterVisibleMessages,
  type QueuedStatus,
} from './filter-visible-messages';

type Msg = { id: string; role: 'user' | 'assistant' | 'system' };

function user(id: string): Msg {
  return { id, role: 'user' };
}
function assistant(id: string): Msg {
  return { id, role: 'assistant' };
}

function map(
  entries: Array<[string, QueuedStatus]>,
): Map<string, { status: QueuedStatus }> {
  return new Map(entries.map(([id, status]) => [id, { status }]));
}

describe('filterVisibleMessages', () => {
  describe('with a resolved queue map', () => {
    const messages = [user('u1'), assistant('a1'), user('u2'), user('u3')];

    it('hides queued and delivered messages', () => {
      const result = filterVisibleMessages(
        messages,
        map([
          ['u2', 'queued'],
          ['u3', 'delivered'],
        ]),
        true,
      );
      expect(result.map((m) => m.id)).toEqual(['u1', 'a1']);
    });

    it('keeps claimed and consumed messages inline', () => {
      const result = filterVisibleMessages(
        messages,
        map([
          ['u2', 'claimed'],
          ['u3', 'consumed'],
        ]),
        true,
      );
      expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'u3']);
    });

    it('keeps messages without a queue entry', () => {
      const result = filterVisibleMessages(messages, map([]), true);
      expect(result).toBe(messages); // identity — no allocation when nothing hidden
    });
  });

  describe('while the queue query is still resolving (undefined)', () => {
    it('returns messages untouched when not generating', () => {
      const messages = [user('u1'), assistant('a1'), user('u2')];
      const result = filterVisibleMessages(messages, undefined, false);
      expect(result).toBe(messages);
    });

    it('withholds trailing user messages after the last assistant', () => {
      // u2 is the running turn's prompt (before a2), u3 is a queued follow-up.
      const messages = [
        user('u1'),
        assistant('a1'),
        user('u2'),
        assistant('a2'),
        user('u3'),
      ];
      const result = filterVisibleMessages(messages, undefined, true);
      expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('never withholds the prompt when no assistant row exists yet', () => {
      const messages = [user('u1'), user('u2')];
      const result = filterVisibleMessages(messages, undefined, true);
      expect(result).toBe(messages);
    });
  });
});
