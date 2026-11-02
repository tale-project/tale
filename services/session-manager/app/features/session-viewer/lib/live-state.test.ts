import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '@/lib/live-view';

import {
  IDLE,
  liveReducer,
  startingSnapshot,
  type LiveAction,
  type LiveSnapshot,
} from './live-state';

function run(actions: LiveAction[], from: LiveSnapshot = IDLE): LiveSnapshot {
  return actions.reduce(liveReducer, from);
}

function message(value: ServerMessage): LiveAction {
  return { type: 'message', message: value };
}

const tab = {
  id: 1,
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  active: true,
};

describe('startingSnapshot', () => {
  it('starts connecting when the session runs, idle otherwise', () => {
    expect(startingSnapshot(true).state).toBe('connecting');
    expect(startingSnapshot(false)).toBe(IDLE);
  });
});

describe('liveReducer', () => {
  it('goes from connecting to live with the first picture', () => {
    expect(run([{ type: 'connecting' }, { type: 'picture' }]).state).toBe(
      'live',
    );
  });

  it('counts the tries that failed in a row, and a picture, which proves the connection, starts the count over', () => {
    expect(IDLE.failures).toBe(0);
    const lost = run([{ type: 'connecting' }, { type: 'lost' }]);
    expect(lost.failures).toBe(1);
    const again = run(
      [{ type: 'connecting' }, { type: 'lost' }, { type: 'connecting' }],
      lost,
    );
    expect(again.failures).toBe(2);
    expect(run([{ type: 'picture' }], again).failures).toBe(0);
  });

  it('does not take a reset, a new connection or an end for a failed try', () => {
    const lost = run([{ type: 'lost' }]);
    expect(run([{ type: 'connecting' }], lost).failures).toBe(1);
    expect(
      run([{ type: 'ended', end: { reason: 'closed' } }], lost).failures,
    ).toBe(1);
    expect(run([{ type: 'reset' }], lost).failures).toBe(0);
  });

  it('keeps the same snapshot when nothing changes', () => {
    const live = run([{ type: 'connecting' }, { type: 'picture' }]);
    expect(liveReducer(live, { type: 'picture' })).toBe(live);
    const connecting = startingSnapshot(true);
    expect(liveReducer(connecting, { type: 'connecting' })).toBe(connecting);
  });

  it('remembers the tabs and the view of the tab', () => {
    const snapshot = run([
      message({ t: 'tabs', tabs: [tab] }),
      message({ t: 'view', tab: 1, w: 1920, h: 1080 }),
    ]);
    expect(snapshot.tabs).toEqual([tab]);
    expect(snapshot.view).toEqual({ tab: 1, w: 1920, h: 1080 });
  });

  it('replaces the tabs with the newest', () => {
    const snapshot = run([
      message({ t: 'tabs', tabs: [tab] }),
      message({ t: 'tabs', tabs: [{ ...tab, id: 2 }] }),
    ]);
    expect(snapshot.tabs.map((item) => item.id)).toEqual([2]);
  });

  it('shows one list at a time, and the answer takes it away', () => {
    const open = (token: number): LiveAction =>
      message({
        t: 'select',
        token,
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        options: [{ label: 'A', selected: true, disabled: false, group: null }],
      });
    expect(run([open(1), open(2)]).selectMenu?.token).toBe(2);
    expect(run([open(1), { type: 'list-answered' }]).selectMenu).toBeNull();
  });

  it('collects the dialogs in the order they came', () => {
    const dialog = (id: number): LiveAction =>
      message({
        t: 'dialog',
        id,
        tab: 1,
        kind: 'alert',
        message: `m${id}`,
        default: '',
      });
    expect(run([dialog(5), dialog(6)]).dialogs.map((d) => d.id)).toEqual([
      5, 6,
    ]);
  });

  it('shows a dialog that the server asks again once, at the end', () => {
    const dialog = (id: number): LiveAction =>
      message({
        t: 'dialog',
        id,
        tab: 1,
        kind: 'confirm',
        message: 'again',
        default: '',
      });
    expect(
      run([dialog(5), dialog(6), dialog(5)]).dialogs.map((d) => d.id),
    ).toEqual([6, 5]);
  });

  it('removes a dialog the page closed, or that was answered', () => {
    const open: LiveAction = message({
      t: 'dialog',
      id: 9,
      tab: 1,
      kind: 'alert',
      message: 'x',
      default: '',
    });
    expect(run([open, message({ t: 'dialog_closed', id: 9 })]).dialogs).toEqual(
      [],
    );
    expect(run([open, { type: 'dialog-answered', id: 9 }]).dialogs).toEqual([]);
    expect(
      run([open, { type: 'dialog-answered', id: 10 }]).dialogs,
    ).toHaveLength(1);
  });

  it('forgets lists and dialogs when the connection is lost, but keeps the tabs and the view', () => {
    const snapshot = run([
      { type: 'connecting' },
      message({ t: 'tabs', tabs: [tab] }),
      message({ t: 'view', tab: 1, w: 800, h: 600 }),
      message({
        t: 'dialog',
        id: 1,
        tab: 1,
        kind: 'alert',
        message: 'x',
        default: '',
      }),
      message({
        t: 'select',
        token: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        options: [],
      }),
      { type: 'picture' },
      { type: 'lost' },
    ]);
    expect(snapshot).toMatchObject({
      state: 'lost',
      dialogs: [],
      selectMenu: null,
      view: { w: 800, h: 600 },
    });
    expect(snapshot.tabs).toHaveLength(1);
  });

  it('remembers why the connection ended', () => {
    expect(run([{ type: 'ended', end: { reason: 'closed' } }]).end).toEqual({
      reason: 'closed',
    });
  });

  it('forgets everything on reset', () => {
    const snapshot = run([
      message({ t: 'tabs', tabs: [tab] }),
      { type: 'ended', end: { reason: 'closed' } },
      { type: 'reset' },
    ]);
    expect(snapshot).toBe(IDLE);
  });

  it('shows nothing of the messages that answer a request', () => {
    const before = run([message({ t: 'tabs', tabs: [tab] })]);
    expect(
      liveReducer(before, message({ t: 'selection', text: 'x', cut: false })),
    ).toBe(before);
    expect(liveReducer(before, message({ t: 'closed' }))).toBe(before);
    expect(liveReducer(before, message({ t: 'error', message: 'no' }))).toBe(
      before,
    );
  });
});
