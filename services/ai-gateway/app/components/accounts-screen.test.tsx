import { LocaleProvider } from '@tale/ui/i18n/locale-provider';
import { TooltipProvider } from '@tale/ui/tooltip';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type AccountView, type UsageWindow } from '@/app/lib/api';
import { i18n } from '@/lib/i18n/i18n';

import { AccountsScreen } from './accounts-screen';

const api = vi.hoisted(() => ({ command: vi.fn() }));
const reloadPage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/app/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/api')>();
  return { ...actual, gatewayApi: { ...actual.gatewayApi, ...api } };
});
vi.mock('@/app/lib/leave-for', () => ({ leaveFor: vi.fn(), reloadPage }));
vi.mock('@tale/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
// The title strip wants the app's theme and locale providers, and has
// nothing to say about the list.
vi.mock('./panel-header', () => ({ PanelHeader: () => null }));

const account: AccountView = {
  id: 'account-1',
  provider: 'anthropic',
  label: 'Team seat',
  accountEmail: 'seat@example.com',
  subscription: { plan: 'max', tier: '20x' },
  status: 'active',
  state: 'available',
  limitedUntil: null,
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-24T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

// The panel reads the clock for its countdowns; every figure below is fixed
// against it.
const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

/** One window, resetting `resetsInMs` from now. */
function win(
  kind: UsageWindow['kind'],
  utilization: number,
  resetsInMs: number,
  overrides: Partial<UsageWindow> = {},
): UsageWindow {
  return {
    kind,
    label: null,
    utilization,
    resetsAt: at(resetsInMs),
    windowSeconds: kind === 'session' ? 5 * 60 * 60 : 7 * 24 * 60 * 60,
    blocking: false,
    ...overrides,
  };
}

/** An account in the pool whose reading holds these windows. */
function reading(
  label: string,
  windows: UsageWindow[],
  overrides: Partial<AccountView> = {},
): AccountView {
  return {
    ...account,
    id: label,
    label,
    accountEmail: null,
    usage: {
      windows,
      checkedAt: at(-MINUTE),
      stale: false,
      limited: null,
    },
    ...overrides,
  };
}

/** A limited account, back at `limitedUntil`; its spent windows carry the flag. */
function limited(
  label: string,
  windows: UsageWindow[],
  limitedUntil: string | null,
  overrides: Partial<AccountView> = {},
): AccountView {
  return reading(label, windows, {
    state: 'limited',
    limitedUntil,
    ...overrides,
  });
}

/** The table row a label sits in. */
function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest('tr');
  if (!row) throw new Error(`No row holds ${label}`);
  return row;
}

const signedOut = () =>
  new ApiError('signed_out', 'The sign-in has run out.', 0);
const unreachable = () => new ApiError('unreachable', 'Failed to fetch', 0);

function show(accounts: AccountView[] | null, error: Error | null) {
  const onReload = vi.fn();
  render(
    <LocaleProvider>
      <TooltipProvider>
        <AccountsScreen
          accounts={accounts}
          error={error}
          onReload={onReload}
          providers={['anthropic', 'openai']}
        />
      </TooltipProvider>
    </LocaleProvider>,
  );
  return { onReload };
}

describe('AccountsScreen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    // Only the clock: the table's own timers keep running for real.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset, not clear: a test that stops early must not leave its queued
    // answers for the next one to receive.
    vi.resetAllMocks();
    vi.restoreAllMocks();
    // jsdom has no clipboard; a test that lends one takes it back.
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('keeps the rows when a re-read fails, and says they may be behind', () => {
    const { onReload } = show([account], unreachable());

    expect(screen.getByText('Team seat')).toBeTruthy();
    expect(
      screen.getByText('The account list could not be refreshed'),
    ).toBeTruthy();
    // The toolbar is still there: the reader can still add and search.
    expect(screen.getByRole('button', { name: 'Add account' })).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('says the session ran out, and signs in again through a page load', () => {
    const { onReload } = show([account], signedOut());

    expect(screen.getByText('Team seat')).toBeTruthy();
    expect(screen.getByText('Your session expired')).toBeTruthy();
    expect(
      screen.queryByText('The account list could not be refreshed'),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('says nothing above a list that reads fine', () => {
    show([account], null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes the table’s own failure state when nothing was ever read', () => {
    const { onReload } = show(null, unreachable());

    expect(
      screen.getByRole('heading', { name: /Something went wrong/ }),
    ).toBeTruthy();
    expect(
      screen.queryByText('The account list could not be refreshed'),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('retries a list never read with a page load when the session ran out', () => {
    const { onReload } = show(null, signedOut());

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('says an action met a session that ran out, and re-reads the list', async () => {
    api.command.mockRejectedValueOnce(signedOut());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onReload } = show([account], null);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Account actions' }), {
      key: 'Enter',
    });
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Copy CLI command' }),
      );
    });

    expect(toast).toHaveBeenCalledWith({
      title: 'Your session expired',
      variant: 'destructive',
    });
    // Re-reading now puts the notice that offers to sign in again on screen
    // rather than a minute from now.
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('greys a row whose quota is spent, and no other', () => {
    show(
      [
        limited(
          'Session spent',
          [
            win('session', 100, 5 * MINUTE, { blocking: true }),
            win('weekly', 40, 3 * DAY),
          ],
          at(5 * MINUTE),
        ),
        limited(
          'Week spent',
          [win('weekly', 100, 3 * DAY, { blocking: true })],
          at(3 * DAY),
        ),
        reading('Model capped', [
          win('session', 20, 2 * HOUR),
          win('scoped', 100, 3 * DAY, { label: 'Fable' }),
        ]),
        reading('Nearly spent', [win('session', 99.6, 2 * HOUR)]),
        reading('Lapsed', [win('weekly', 100, 3 * DAY)], {
          status: 'expired',
          state: 'expired',
        }),
      ],
      null,
    );

    expect(rowOf('Session spent').className).toContain('opacity-60');
    expect(rowOf('Week spent').className).toContain('opacity-60');
    expect(rowOf('Model capped').className).not.toContain('opacity');
    expect(rowOf('Nearly spent').className).not.toContain('opacity');
    // A credential that needs attention is its own state; its stale figures
    // do not also make it look switched off.
    expect(rowOf('Lapsed').className).not.toContain('opacity');
  });

  it('spares the state and the clock from the grey, since they are why the row is grey', () => {
    show(
      [
        limited(
          'Week spent',
          [win('weekly', 100, 3 * DAY, { blocking: true })],
          at(3 * DAY),
        ),
      ],
      null,
    );

    const row = rowOf('Week spent');
    const cellOf = (text: string) => {
      const cell = within(row).getByText(text).closest('td');
      if (!cell) throw new Error(`No cell holds ${text}`);
      return cell;
    };
    // The row dims every cell but the menu's and the ones that opt out.
    expect(row.className).toContain(':not(.stays-bright)');
    expect(cellOf('Limit reached').className).toContain('stays-bright');
    expect(cellOf('3 days').className).toContain('stays-bright');
    expect(cellOf('Week spent').className).not.toContain('stays-bright');
  });

  it('keeps every action on a spent row working', async () => {
    api.command.mockResolvedValueOnce('claude');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    show(
      [
        limited(
          'Week spent',
          [win('weekly', 100, 3 * DAY, { blocking: true })],
          at(3 * DAY),
        ),
      ],
      null,
    );

    fireEvent.keyDown(
      within(rowOf('Week spent')).getByRole('button', {
        name: 'Account actions',
      }),
      { key: 'Enter' },
    );
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Copy CLI command' }),
      );
    });

    expect(api.command).toHaveBeenCalledWith('Week spent');
    expect(writeText).toHaveBeenCalledWith('claude');
    expect(toast).toHaveBeenCalledWith({
      title: 'The command for Week spent is on your clipboard.',
      variant: 'success',
    });
  });

  it('dims a stale reading once: by itself when the row is not receded, not again when it is', () => {
    const stale = (windows: UsageWindow[]) => ({
      windows,
      checkedAt: at(-10 * MINUTE),
      stale: true,
      limited: null,
    });
    const spent = [win('weekly', 100, 3 * DAY, { blocking: true })];
    const room = [win('weekly', 10, 3 * DAY)];
    show(
      [
        limited('Limited stale', spent, at(3 * DAY), { usage: stale(spent) }),
        reading('Ready stale', room, { usage: stale(room) }),
      ],
      null,
    );

    const figures = (label: string) => {
      const grid = rowOf(label).querySelector(
        'div[class*="grid-cols-[4rem_auto]"]',
      );
      if (!grid) throw new Error(`No usage figures in ${label}`);
      return grid;
    };
    // The receded row already carries the dim; stacking the reading's own
    // on it leaves a third of full strength.
    expect(figures('Limited stale').className).not.toContain('opacity-60');
    expect(rowOf('Limited stale').className).toContain('opacity-60');
    // A row that is not receded dims the old figures itself.
    expect(figures('Ready stale').className).toContain('opacity-60');
  });

  describe('when a limited account comes back', () => {
    // The case the column exists for: the session window is back in five
    // minutes, the week in three days — and the account is back in three days.
    const both = limited(
      'Both spent',
      [
        win('session', 100, 5 * MINUTE, { blocking: true }),
        win('weekly', 100, 3 * DAY, { blocking: true }),
      ],
      at(3 * DAY),
    );

    it('says three days in words, not five minutes', () => {
      show([both], null);
      const row = within(rowOf('Both spent'));
      expect(row.getByText('Limit reached')).toBeTruthy();
      expect(row.getByText('Resets in 3 days')).toBeTruthy();
      expect(row.queryByText('Resets in 5 minutes')).toBeNull();
    });

    it('reads the week’s clock in full strength and the session’s as one that only waits', () => {
      show([both], null);
      const row = within(rowOf('Both spent'));
      const clock = (text: string) => {
        const element = row.getByText(text).parentElement;
        if (!element) throw new Error(`No clock holds ${text}`);
        return element;
      };
      expect(clock('3 days').className).toContain('font-medium');
      expect(clock('5 minutes').className).not.toContain('font-medium');
      // Nothing to celebrate yet: the session is back soon, the account is not.
      expect(clock('5 minutes').className).not.toContain('text-success');
      expect(clock('3 days').className).not.toContain('text-success');
    });

    it('reads the session’s clock when only the session is spent', () => {
      show(
        [
          limited(
            'Session spent',
            [
              win('session', 100, 5 * MINUTE, { blocking: true }),
              win('weekly', 41, 3 * DAY),
            ],
            at(5 * MINUTE),
          ),
        ],
        null,
      );
      const row = within(rowOf('Session spent'));
      expect(row.getByText('Resets in 5 minutes')).toBeTruthy();
      expect(row.getByText('5 minutes').parentElement?.className).toContain(
        'font-medium',
      );
      expect(row.getByText('3 days').parentElement?.className).not.toContain(
        'font-medium',
      );
    });

    it('tints the return only inside the hour — and never a countdown nothing waits on', () => {
      show(
        [
          limited(
            'Back soon',
            [
              win('session', 100, 25 * MINUTE, { blocking: true }),
              win('weekly', 40, 3 * DAY),
            ],
            at(25 * MINUTE),
          ),
          reading('Ready', [
            win('session', 30, 20 * MINUTE),
            win('weekly', 40, 3 * DAY),
          ]),
        ],
        null,
      );
      const soon = within(rowOf('Back soon'));
      expect(soon.getByText('25 minutes').parentElement?.className).toContain(
        'text-success',
      );
      expect(soon.getByText('3 days').parentElement?.className).not.toContain(
        'text-success',
      );
      // A window that merely resets soon, on an account with quota left, is
      // an ordinary countdown.
      const ready = within(rowOf('Ready'));
      expect(
        ready.getByText('20 minutes').parentElement?.className,
      ).not.toContain('text-success');
      expect(ready.getByText('Available')).toBeTruthy();
    });

    it('says so when no return is known', () => {
      show(
        [
          limited(
            'Unknown',
            [win('weekly', 100, 3 * DAY, { blocking: true, resetsAt: null })],
            null,
          ),
        ],
        null,
      );
      expect(
        within(rowOf('Unknown')).getByText('Reset time unknown'),
      ).toBeTruthy();
    });

    it('says now for a rollover that has come, before the next reading catches up', () => {
      show(
        [
          reading('Rolled over', [win('session', 100, -MINUTE)], {
            usage: {
              windows: [win('session', 100, -MINUTE)],
              checkedAt: at(-10 * MINUTE),
              stale: true,
              limited: null,
            },
          }),
        ],
        null,
      );
      const row = within(rowOf('Rolled over'));
      expect(row.getByText('Now')).toBeTruthy();
      expect(row.getByText('Available')).toBeTruthy();
    });
  });

  it('lists a vendor’s accounts together, and inside it by state, then by who is back first', () => {
    show(
      [
        reading('Gpt ready', [win('weekly', 10, 2 * DAY)], {
          provider: 'openai',
        }),
        reading('Claude broken', [], { status: 'error', state: 'error' }),
        limited(
          'Claude in 3 days',
          [win('weekly', 100, 3 * DAY, { blocking: true })],
          at(3 * DAY),
        ),
        reading('Claude lapsed', [], { status: 'expired', state: 'expired' }),
        limited(
          'Claude in 5 minutes',
          [win('session', 100, 5 * MINUTE, { blocking: true })],
          at(5 * MINUTE),
        ),
        reading('Claude ready', [win('weekly', 10, 2 * DAY)]),
      ],
      null,
    );

    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const position = (label: string) =>
      rows.findIndex((text) => text.includes(label));
    const ordered = [
      'Claude ready',
      'Claude in 5 minutes',
      'Claude in 3 days',
      'Claude lapsed',
      'Claude broken',
      'Gpt ready',
    ];
    expect(ordered.map(position)).toEqual(
      ordered.map(position).toSorted((a, b) => a - b),
    );
    expect(ordered.map(position).every((index) => index > 0)).toBe(true);
  });

  it('finds an account by the state the reader sees', async () => {
    show(
      [
        reading('Claude ready', [win('weekly', 10, 2 * DAY)]),
        limited(
          'Claude spent',
          [win('weekly', 100, 3 * DAY, { blocking: true })],
          at(3 * DAY),
        ),
      ],
      null,
    );

    const search = screen.getByRole('textbox', { name: 'Search accounts' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'limit' } });

    await waitFor(() => {
      expect(screen.queryByText('Claude ready')).toBeNull();
    });
    expect(screen.getByText('Claude spent')).toBeTruthy();
  });

  it('filters by the four states the rows are grouped in', async () => {
    show(
      [
        reading('Claude ready', [win('weekly', 10, 2 * DAY)]),
        limited(
          'Claude spent',
          [win('weekly', 100, 3 * DAY, { blocking: true })],
          at(3 * DAY),
        ),
        reading('Claude lapsed', [], { status: 'expired', state: 'expired' }),
      ],
      null,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    // The facet lists the states best to worst, as the rows sit.
    const status = await screen.findByRole('button', { name: /Status/ });
    fireEvent.click(status);
    await screen.findAllByRole('checkbox');
    for (const name of [
      'Available',
      'Limit reached',
      'Needs reauthentication',
      'Last call failed',
    ]) {
      expect(screen.getByRole('checkbox', { name })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('checkbox', { name: 'Limit reached' }));
    await waitFor(() => {
      expect(screen.queryByText('Claude ready')).toBeNull();
    });
    expect(screen.getByText('Claude spent')).toBeTruthy();
    expect(screen.queryByText('Claude lapsed')).toBeNull();
  });

  it('keeps an action’s own failure for anything else', async () => {
    api.command.mockRejectedValueOnce(unreachable());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onReload } = show([account], null);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Account actions' }), {
      key: 'Enter',
    });
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Copy CLI command' }),
      );
    });

    expect(toast).toHaveBeenCalledWith({
      title: 'The command could not be read.',
      variant: 'destructive',
    });
    expect(onReload).not.toHaveBeenCalled();
  });
});
