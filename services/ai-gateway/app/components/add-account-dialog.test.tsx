import { TooltipProvider } from '@tale/ui/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountView } from '@/app/lib/api';
import { i18n } from '@/lib/i18n/i18n';

import { AddAccountDialog } from './add-account-dialog';

const api = vi.hoisted(() => ({
  authorize: vi.fn(),
  authorizationStatus: vi.fn(),
  complete: vi.fn(),
}));
const leaveFor = vi.hoisted(() => vi.fn());

vi.mock('@/app/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/api')>();
  return { ...actual, gatewayApi: { ...actual.gatewayApi, ...api } };
});
vi.mock('@/app/lib/leave-for', () => ({ leaveFor }));

const account: AccountView = {
  id: 'account-1',
  provider: 'openai',
  label: 'you@example.com',
  accountEmail: 'you@example.com',
  subscription: { plan: 'plus', tier: null },
  status: 'active',
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-24T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

const device = {
  state: 'state-1',
  flow: 'device' as const,
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'VRYD-8JCQS',
  expiresAt: null,
  pollIntervalSeconds: 5,
};

function open(onConnected = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <TooltipProvider>
      <AddAccountDialog
        onConnected={onConnected}
        onOpenChange={onOpenChange}
        open
        // One provider, so the picker starts on it and the tests never have
        // to drive a Radix select through jsdom.
        providers={['openai']}
        target={{ account: null }}
      />
    </TooltipProvider>,
  );
  return { onConnected, onOpenChange };
}

async function continueTo(flow: unknown) {
  api.authorize.mockResolvedValueOnce(flow);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  });
}

/** Let the dialog's timers run, and the promises they start settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('AddAccountDialog', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset, not clear: a test that stops early must not leave its queued
    // answers for the next one to receive.
    vi.resetAllMocks();
  });

  it('waits on a device code and closes by itself once it is approved', async () => {
    const { onConnected, onOpenChange } = open();
    await continueTo(device);

    expect(screen.getAllByText('VRYD-8JCQS').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('link', { name: /Open the sign-in page/ }),
    ).toHaveProperty('href', 'https://auth.openai.com/codex/device');
    expect(screen.getByText(/Waiting for your approval/)).toBeTruthy();

    api.authorizationStatus
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'connected', account });
    await advance(5000);
    expect(api.authorizationStatus).toHaveBeenCalledTimes(1);
    expect(onConnected).not.toHaveBeenCalled();

    await advance(5000);
    expect(onConnected).toHaveBeenCalledWith(account);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks at once when the reader comes back to the tab', async () => {
    open();
    await continueTo(device);
    api.authorizationStatus.mockResolvedValue({ status: 'pending' });

    // Approving happens in another tab; coming back is the moment to look.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(api.authorizationStatus).toHaveBeenCalledTimes(1);
  });

  it('says a code ran out, and offers a fresh one', async () => {
    open();
    await continueTo(device);
    api.authorizationStatus.mockResolvedValueOnce({
      status: 'failed',
      code: 'expired',
    });
    await advance(5000);

    expect(
      screen.getByText(/That code ran out before it was approved/),
    ).toBeTruthy();
    // The wait is over: nothing asks again.
    await advance(20_000);
    expect(api.authorizationStatus).toHaveBeenCalledTimes(1);

    api.authorize.mockResolvedValueOnce({
      ...device,
      state: 'state-2',
      userCode: 'NEW0-CODE1',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    });
    expect(api.authorize).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('NEW0-CODE1').length).toBeGreaterThan(0);
  });

  it('stops asking once the dialog is closed', async () => {
    const { onOpenChange } = open();
    await continueTo(device);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await advance(20_000);
    expect(api.authorizationStatus).not.toHaveBeenCalled();
  });

  it('takes the browser flow when asked, and pastes its address back', async () => {
    const { onConnected } = open();
    await continueTo(device);

    api.authorize.mockResolvedValueOnce({
      state: 'state-2',
      flow: 'paste',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=state-2',
      pasteStyle: 'redirect-url',
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sign in through the browser instead',
        }),
      );
    });
    expect(api.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'openai', method: 'browser' }),
    );

    api.complete.mockResolvedValueOnce(account);
    fireEvent.change(screen.getByLabelText('Authorization result'), {
      target: {
        value: 'http://localhost:1455/auth/callback?code=c&state=state-2',
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(api.complete).toHaveBeenCalledWith({
      state: 'state-2',
      pasted: 'http://localhost:1455/auth/callback?code=c&state=state-2',
    });
    expect(onConnected).toHaveBeenCalledWith(account);
  });

  it('sends a redirect flow straight to the vendor', async () => {
    open();
    await continueTo({
      state: 'state-1',
      flow: 'redirect',
      authorizeUrl: 'https://claude.ai/oauth/authorize?state=state-1',
    });
    expect(leaveFor).toHaveBeenCalledWith(
      'https://claude.ai/oauth/authorize?state=state-1',
    );
  });

  it('hands the name typed in step one to the start of the sign-in', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  team seat ' },
    });
    await continueTo(device);
    expect(api.authorize).toHaveBeenCalledWith({
      provider: 'openai',
      accountId: null,
      label: 'team seat',
      method: undefined,
    });
  });
});
