import { LocaleProvider } from '@tale/ui/i18n/locale-provider';
import { TooltipProvider } from '@tale/ui/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-24T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

/** An account in the pool whose reading holds these windows. */
function reading(
  label: string,
  windows: Array<
    Pick<UsageWindow, 'kind' | 'utilization'> & Partial<UsageWindow>
  >,
): AccountView {
  return {
    ...account,
    id: label,
    label,
    accountEmail: null,
    usage: {
      windows: windows.map((window) => ({
        label: null,
        resetsAt: '2026-09-24T12:00:00.000Z',
        windowSeconds: 5 * 60 * 60,
        ...window,
      })),
      checkedAt: '2026-09-24T10:00:00.000Z',
      stale: false,
    },
  };
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
  });

  afterEach(() => {
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

  it('greys a row whose session or weekly window is spent, and no other', () => {
    show(
      [
        reading('Session spent', [
          { kind: 'session', utilization: 100 },
          { kind: 'weekly', utilization: 40 },
        ]),
        reading('Week spent', [{ kind: 'weekly', utilization: 100 }]),
        reading('Model capped', [
          { kind: 'session', utilization: 20 },
          { kind: 'scoped', label: 'Fable', utilization: 100 },
        ]),
        reading('Nearly spent', [{ kind: 'session', utilization: 99.6 }]),
      ],
      null,
    );

    expect(rowOf('Session spent').className).toContain('opacity-60');
    expect(rowOf('Week spent').className).toContain('opacity-60');
    expect(rowOf('Model capped').className).not.toContain('opacity');
    expect(rowOf('Nearly spent').className).not.toContain('opacity');
  });

  it('keeps every action on a spent row working', async () => {
    api.command.mockResolvedValueOnce('claude');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    show([reading('Week spent', [{ kind: 'weekly', utilization: 100 }])], null);

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
