import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { errorText } from '@/tests/utils/errors';
import { runningSession, session } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderHookApp } from '@/tests/utils/render';

import { useSecondLine } from './use-second-line';

afterEach(async () => {
  // Unmounted before the language goes back, or the rows would render twice.
  cleanup();
  await resetLanguage();
});

function lineOf(overrides: Parameters<typeof session>[0]) {
  return renderHookApp(() => useSecondLine(session(overrides))).result.current;
}

/** How the app words a failure of that code in the language shown now. */
const worded = errorText;

const CAUSE = 'the proxy rejected the credentials (HTTP 407)';

describe('the second line of a session that failed', () => {
  it('says why its proxy does not work, in the words of the proxy check', () => {
    const line = lineOf({
      status: 'error',
      errorCode: 'proxy_unreachable',
      errorExtra: { proxyId: 4, reason: CAUSE },
      error: `Its proxy is not working: ${CAUSE}. Use “Rotate IP” to give the session another proxy.`,
    });
    expect(line).toEqual({
      text: worded('proxy_unreachable', { reason: CAUSE }),
      tone: 'error',
    });
    expect(line.text).toContain(CAUSE);
  });

  it('says only that the proxy does not work when the session carries no cause', () => {
    const line = lineOf({
      status: 'error',
      errorCode: 'proxy_unreachable',
      errorExtra: null,
      error: 'Its proxy is not working.',
    });
    expect(line).toEqual({
      text: worded('proxy_unreachable'),
      tone: 'error',
    });
    expect(line.text).not.toContain(CAUSE);
  });

  it('says how many proxies failed their check when none was left to give', () => {
    const line = lineOf({
      status: 'error',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 3 },
      error: 'No working proxy available (3 failed their check).',
    });
    expect(line.text).toBe(worded('no_working_proxy', { failed: 3 }));
    expect(line.text).toContain('3');
    expect(
      lineOf({
        status: 'error',
        errorCode: 'no_working_proxy',
        errorExtra: { failed: 1 },
      }).text,
    ).toBe(worded('no_working_proxy', { failed: 1 }));
  });

  it('says why the time zone and location cannot be matched', () => {
    const reason = 'the GeoIP database has no location for 203.0.113.7';
    const line = lineOf({
      status: 'error',
      errorCode: 'unknown_ip_location',
      errorExtra: { reason },
    });
    expect(line.text).toBe(worded('unknown_ip_location', { reason }));
    expect(line.text).toContain(reason);
  });

  it('puts the cause in a German sentence, with the plural of the language', async () => {
    await showLanguage('de');
    expect(
      lineOf({
        status: 'error',
        errorCode: 'no_working_proxy',
        errorExtra: { failed: 2 },
      }).text,
    ).toBe(worded('no_working_proxy', { failed: 2 }));
    expect(
      lineOf({
        status: 'error',
        errorCode: 'proxy_unreachable',
        errorExtra: { reason: CAUSE },
      }).text,
    ).toBe(worded('proxy_unreachable', { reason: CAUSE }));
    expect(worded('no_working_proxy', { failed: 2 })).toMatch(/Prüfung/);
  });

  it('puts the cause in a French sentence, with the plural of the language', async () => {
    await showLanguage('fr');
    const text = lineOf({
      status: 'error',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 1 },
    }).text;
    expect(text).toBe(worded('no_working_proxy', { failed: 1 }));
    expect(text).toMatch(/vérification/);
  });

  it('shows the first line of what a failure with a code the app does not word says', () => {
    expect(
      lineOf({
        status: 'error',
        errorCode: 'something_new',
        errorExtra: { reason: 'x' },
        error: 'The browser crashed.\n  at launch (browser.ts:12)',
      }),
    ).toEqual({ text: 'The browser crashed.', tone: 'error' });
  });

  it('shows the first line of a failure that has no code, and says "Error" when it has no words', () => {
    expect(lineOf({ status: 'error', error: 'Disk full' }).text).toBe(
      'Disk full',
    );
    expect(lineOf({ status: 'error' }).text).toBe('Error');
  });
});

describe('the second line of a stopped session whose last proxy change failed', () => {
  // The session stays "stopped" and carries the failure until its next start:
  // the list must not hide it behind a plain state.
  it('says what failed, like a session in error does', () => {
    const line = lineOf({
      status: 'stopped',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 3 },
      error: 'No working proxy available (3 failed their check).',
    });
    expect(line).toEqual({
      text: worded('no_working_proxy', { failed: 3 }),
      tone: 'error',
    });
  });

  it('shows the first line of a failure the app has no words for', () => {
    expect(
      lineOf({ status: 'stopped', error: 'Disk full\nat rotate' }),
    ).toEqual({ text: 'Disk full', tone: 'error' });
  });

  it('says only that it is stopped when nothing failed', () => {
    expect(lineOf({ status: 'stopped' })).toEqual({
      text: 'Stopped',
      tone: 'plain',
    });
  });

  it('says what it is doing, not an old failure, while it works', () => {
    expect(
      lineOf({
        status: 'stopped',
        activity: 'assigning_proxy',
        errorCode: 'no_working_proxy',
        error: 'x',
      }),
    ).toEqual({ text: 'Assigning proxy', tone: 'plain' });
  });
});

describe('the second line of the other states', () => {
  it('says where a running session exits', () => {
    expect(
      renderHookApp(() => useSecondLine(runningSession())).result.current,
    ).toEqual({ text: '203.0.113.7 · DE', tone: 'plain' });
  });

  it('warns that the IP changed when the proxy exits through another one', () => {
    const base = runningSession();
    expect(
      renderHookApp(() =>
        useSecondLine(
          runningSession({
            location: base.location && { ...base.location, inSync: false },
          }),
        ),
      ).result.current,
    ).toEqual({ text: 'IP changed · restart recommended', tone: 'warning' });
  });

  it('says the state of a session that is neither running nor failed', () => {
    expect(lineOf({ status: 'starting', activity: 'launching' })).toEqual({
      text: 'Starting',
      tone: 'plain',
    });
    expect(lineOf({ status: 'stopping', activity: 'launching' })).toEqual({
      text: 'Stopping',
      tone: 'plain',
    });
  });
});
