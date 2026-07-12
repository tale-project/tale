// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const toastMock = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// Controllable stand-in for TanStack's useBlocker: captures the options so
// tests can invoke `shouldBlockFn` directly, and lets tests flip the blocked
// state the dialog renders from.
interface MockBlockerState {
  status: 'idle' | 'blocked';
  proceed: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}
const blockerState: MockBlockerState = {
  status: 'idle',
  proceed: vi.fn(),
  reset: vi.fn(),
};
let capturedBlockerOpts:
  | {
      shouldBlockFn: (args: { next: { pathname: string } }) => boolean;
      enableBeforeUnload: () => boolean;
    }
  | undefined;
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (opts: never) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    capturedBlockerOpts = opts as typeof capturedBlockerOpts;
    return blockerState;
  },
}));

import { DirtyBlockerProvider } from './dirty-blocker-provider';
import {
  useRegisterDirtySource,
  type DirtySourceOptions,
} from './use-dirty-source';

function Source({
  dirty,
  options,
}: {
  dirty: boolean;
  options?: DirtySourceOptions;
}) {
  useRegisterDirtySource(dirty, options);
  return null;
}

beforeEach(() => {
  blockerState.status = 'idle';
  blockerState.proceed = vi.fn();
  blockerState.reset = vi.fn();
  capturedBlockerOpts = undefined;
  toastMock.mockClear();
});

describe('DirtyBlockerProvider', () => {
  it('does not block navigation that stays inside a dirty source’s scope (#2572)', () => {
    render(
      <DirtyBlockerProvider>
        <Source dirty options={{ scopePath: '/dashboard/org/agents/a' }} />
      </DirtyBlockerProvider>,
    );

    // Tab-to-tab inside the same agent: allowed.
    expect(
      capturedBlockerOpts?.shouldBlockFn({
        next: { pathname: '/dashboard/org/agents/a/instructions' },
      }),
    ).toBe(false);
    expect(
      capturedBlockerOpts?.shouldBlockFn({
        next: { pathname: '/dashboard/org/agents/a' },
      }),
    ).toBe(false);

    // Leaving the agent: blocked.
    expect(
      capturedBlockerOpts?.shouldBlockFn({
        next: { pathname: '/dashboard/org/agents' },
      }),
    ).toBe(true);
    // Prefix boundary: a sibling agent whose slug merely extends the scope
    // string must still block.
    expect(
      capturedBlockerOpts?.shouldBlockFn({
        next: { pathname: '/dashboard/org/agents/ab' },
      }),
    ).toBe(true);
  });

  it('blocks every navigation for an unscoped dirty source', () => {
    render(
      <DirtyBlockerProvider>
        <Source dirty />
      </DirtyBlockerProvider>,
    );
    expect(
      capturedBlockerOpts?.shouldBlockFn({ next: { pathname: '/anywhere' } }),
    ).toBe(true);
    expect(capturedBlockerOpts?.enableBeforeUnload()).toBe(true);
  });

  it('offers Save & Leave when every dirty source registered a save, and runs it before proceeding', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    blockerState.status = 'blocked';
    render(
      <DirtyBlockerProvider>
        <Source dirty options={{ save }} />
      </DirtyBlockerProvider>,
    );

    const saveButton = screen.getByRole('button', {
      name: 'common.unsavedChanges.saveAndLeave',
    });
    await user.click(saveButton);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(blockerState.proceed).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('keeps the user on the page (reset + toast) when Save & Leave fails', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValue(new Error('boom'));
    blockerState.status = 'blocked';
    render(
      <DirtyBlockerProvider>
        <Source dirty options={{ save }} />
      </DirtyBlockerProvider>,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'common.unsavedChanges.saveAndLeave',
      }),
    );

    await waitFor(() => expect(blockerState.reset).toHaveBeenCalled());
    expect(blockerState.proceed).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('degrades to Stay/Discard when a dirty source has no save path', () => {
    blockerState.status = 'blocked';
    render(
      <DirtyBlockerProvider>
        <Source dirty options={{ save: vi.fn() }} />
        <Source dirty />
      </DirtyBlockerProvider>,
    );

    expect(
      screen.queryByRole('button', {
        name: 'common.unsavedChanges.saveAndLeave',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'common.unsavedChanges.stay' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'common.unsavedChanges.discardAndLeave',
      }),
    ).toBeInTheDocument();
  });
});
