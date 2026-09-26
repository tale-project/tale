import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  groupHomeItems,
  homeItemKey,
  viewIncludes,
  type HomeItem,
} from './home-items';

// Noon on a Wednesday, local time — far from any midnight edge.
const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function chat(id: string, activityAt: number, pinnedAt?: number): HomeItem {
  return {
    kind: 'chat',
    id,
    title: id,
    activityAt,
    unread: false,
    generating: false,
    shared: false,
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
  };
}

function task(id: string, activityAt: number): HomeItem {
  return {
    kind: 'task',
    id,
    title: id,
    activityAt,
    unread: false,
    status: 'todo',
    awaitingMyReview: false,
  };
}

function conversation(id: string, activityAt: number): HomeItem {
  return {
    kind: 'conversation',
    id,
    title: id,
    activityAt,
    unread: true,
    status: 'open',
  };
}

describe('groupHomeItems', () => {
  it('bands the stream newest first: today, yesterday, this week, earlier', () => {
    const groups = groupHomeItems(
      [
        chat('old', NOW - 30 * DAY),
        task('week', NOW - 3 * DAY),
        conversation('yesterday', NOW - DAY),
        chat('today-early', NOW - 5 * HOUR),
        task('today-late', NOW - HOUR),
      ],
      NOW,
    );
    expect(
      groups.map((group) => [group.key, group.items.map((item) => item.id)]),
    ).toEqual([
      ['today', ['today-late', 'today-early']],
      ['yesterday', ['yesterday']],
      ['thisWeek', ['week']],
      ['earlier', ['old']],
    ]);
  });

  it('floats pinned chats above every band, newest pin first', () => {
    const groups = groupHomeItems(
      [
        chat('recent', NOW - HOUR),
        chat('pinned-first', NOW - 10 * DAY, NOW - 2 * DAY),
        chat('pinned-last', NOW - 20 * DAY, NOW - DAY),
      ],
      NOW,
    );
    expect(groups[0]?.key).toBe('pinned');
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      'pinned-last',
      'pinned-first',
    ]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['recent']);
  });

  describe('across a daylight-saving change', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // Europe/Zurich springs forward on 29 March 2026, a 23-hour day. A
    // "yesterday" counted as 24 hours back from midnight would start at
    // 23:00 on the 28th and pull a late chat from two days ago into it.
    it('keeps each band edge on local midnight', () => {
      vi.stubEnv('TZ', 'Europe/Zurich');
      const now = new Date(2026, 2, 30, 9, 0, 0).getTime();
      const twoDaysAgoLate = new Date(2026, 2, 28, 23, 30, 0).getTime();
      const yesterdayEarly = new Date(2026, 2, 29, 0, 30, 0).getTime();

      const groups = groupHomeItems(
        [
          chat('two-days-ago', twoDaysAgoLate),
          chat('yesterday', yesterdayEarly),
        ],
        now,
      );

      expect(
        groups.map((group) => [group.key, group.items.map((item) => item.id)]),
      ).toEqual([
        ['yesterday', ['yesterday']],
        ['thisWeek', ['two-days-ago']],
      ]);
    });
  });

  it('omits empty bands', () => {
    expect(groupHomeItems([], NOW)).toEqual([]);
    expect(
      groupHomeItems([task('t', NOW - 2 * HOUR)], NOW).map((g) => g.key),
    ).toEqual(['today']);
  });
});

describe('viewIncludes', () => {
  it('shows every kind in All and one kind per focused view', () => {
    expect(viewIncludes('all', 'chat')).toBe(true);
    expect(viewIncludes('all', 'task')).toBe(true);
    expect(viewIncludes('all', 'conversation')).toBe(true);
    expect(viewIncludes('chats', 'chat')).toBe(true);
    expect(viewIncludes('chats', 'task')).toBe(false);
    expect(viewIncludes('tasks', 'task')).toBe(true);
    expect(viewIncludes('tasks', 'conversation')).toBe(false);
    expect(viewIncludes('inbox', 'conversation')).toBe(true);
    expect(viewIncludes('inbox', 'chat')).toBe(false);
  });
});

describe('homeItemKey', () => {
  it('keeps ids from different tables apart', () => {
    expect(homeItemKey(chat('same', NOW))).not.toBe(
      homeItemKey(task('same', NOW)),
    );
  });
});
