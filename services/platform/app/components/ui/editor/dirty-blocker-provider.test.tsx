// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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
    capturedBlockerOpts = opts;
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

  it('offers Keep editing and Discard & Leave only', () => {
    blockerState.status = 'blocked';
    render(
      <DirtyBlockerProvider>
        <Source dirty />
      </DirtyBlockerProvider>,
    );

    expect(
      screen.getByRole('button', { name: 'common.unsavedChanges.stay' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'common.unsavedChanges.discardAndLeave',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'common.unsavedChanges.saveAndLeave',
      }),
    ).not.toBeInTheDocument();
  });

  it('proceeds on Discard & Leave', async () => {
    const user = userEvent.setup();
    blockerState.status = 'blocked';
    render(
      <DirtyBlockerProvider>
        <Source dirty />
      </DirtyBlockerProvider>,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'common.unsavedChanges.discardAndLeave',
      }),
    );
    expect(blockerState.proceed).toHaveBeenCalledTimes(1);
  });
});
