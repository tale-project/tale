import { describe, expect, it } from 'vitest';

import { runningSession, session } from '@/tests/utils/fixtures';

import {
  isIdle,
  isStopped,
  outOfSync,
  shownStatus,
  statusTone,
} from './status';

describe('shownStatus', () => {
  it('puts the background work before the status', () => {
    expect(shownStatus(session({ activity: 'assigning_proxy' }))).toBe(
      'assigning',
    );
    expect(
      shownStatus(session({ activity: 'launching', status: 'starting' })),
    ).toBe('starting');
  });

  it('says Stopping once the session is asked to stop, whatever its browser is still doing', () => {
    // A stop that comes while the browser launches: the launch is still at
    // work until the browser has closed, but the person has said stop.
    expect(
      shownStatus(session({ status: 'stopping', activity: 'launching' })),
    ).toBe('stopping');
    expect(
      shownStatus(session({ status: 'stopping', activity: 'assigning_proxy' })),
    ).toBe('stopping');
  });

  it('otherwise is the status itself', () => {
    for (const status of [
      'stopped',
      'starting',
      'running',
      'stopping',
      'error',
    ] as const) {
      expect(shownStatus(session({ status }))).toBe(status);
    }
  });
});

describe('statusTone', () => {
  it('has a tone for every state a session can show', () => {
    expect(statusTone('running')).toBe('ok');
    expect(statusTone('stopped')).toBe('idle');
    expect(statusTone('assigning')).toBe('accent');
    expect(statusTone('starting')).toBe('accent');
    expect(statusTone('stopping')).toBe('warn');
    expect(statusTone('error')).toBe('danger');
  });
});

describe('outOfSync', () => {
  it('is true only for a running session whose proxy exits through another IP', () => {
    const base = runningSession();
    expect(outOfSync(base)).toBe(false);
    expect(
      outOfSync(
        runningSession({
          location: base.location && { ...base.location, inSync: false },
        }),
      ),
    ).toBe(true);
    expect(
      outOfSync(
        session({
          status: 'stopped',
          location: base.location && { ...base.location, inSync: false },
        }),
      ),
    ).toBe(false);
  });

  it('is false while it is not known', () => {
    const base = runningSession();
    expect(
      outOfSync(
        runningSession({
          location: base.location && { ...base.location, inSync: null },
        }),
      ),
    ).toBe(false);
  });
});

describe('isIdle', () => {
  it('is idle when stopped or failed and nothing is at work', () => {
    expect(isIdle(session())).toBe(true);
    expect(isIdle(session({ status: 'error' }))).toBe(true);
    expect(isIdle(session({ activity: 'assigning_proxy' }))).toBe(false);
    expect(isIdle(session({ status: 'running' }))).toBe(false);
    expect(isIdle(session({ status: 'stopping' }))).toBe(false);
  });
});

describe('isStopped', () => {
  it('is the status alone: stopped or failed, whatever the session is busy with', () => {
    expect(isStopped(session())).toBe(true);
    expect(isStopped(session({ status: 'error' }))).toBe(true);
    // A stopped session that is being given a proxy is still a stopped one.
    expect(isStopped(session({ activity: 'assigning_proxy' }))).toBe(true);
    expect(isStopped(session({ status: 'starting' }))).toBe(false);
    expect(isStopped(session({ status: 'stopping' }))).toBe(false);
    expect(isStopped(runningSession())).toBe(false);
  });
});
