// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ActivityLogView } from './activity-log-view';

const SUMMARY = {
  totalActions: 1310,
  successCount: 1200,
  failureCount: 100,
  deniedCount: 10,
  byCategory: { data: 900, security: 410 },
  topActors: [{ actorId: 'user-1', actorEmail: 'ada@example.com', count: 700 }],
};

const EMPTY_SUMMARY = {
  totalActions: 0,
  successCount: 0,
  failureCount: 0,
  deniedCount: 0,
  byCategory: {},
  topActors: [],
};

// The summary read, steered per test; every test starts on the busy week.
const read = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('../hooks/queries', () => ({
  useActivitySummary: () => read.current,
}));
beforeEach(() => {
  read.current = {
    data: SUMMARY,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
});

// 2026-09-26 evaluation, E-03: the tab showed "1,310 actions" without saying
// the totals covered the last 7 days — the period pick sits behind the
// filter button and the default is its resting state.
describe('ActivityLogView', () => {
  it('captions the stat cards with the period they cover, following the filter', async () => {
    const { user } = render(<ActivityLogView organizationId="org-1" />);

    expect(
      screen.getByText(
        'Period: Last 7 days. All totals below cover this period.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('1,310')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /filter/i }));
    if (screen.queryAllByRole('radio').length === 0) {
      await user.click(screen.getByRole('button', { name: /Period/ }));
    }
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));

    expect(
      screen.getByText(
        'Period: Last 30 days. All totals below cover this period.',
      ),
    ).toBeInTheDocument();
  });
});

// The period is a widening filter: a longer window holds actions the 7-day
// default leaves out, so an empty week never disables it.
describe('ActivityLogView period filter', () => {
  it('stays usable over a week with no action, and widens the window', async () => {
    read.current = {
      data: EMPTY_SUMMARY,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const { user } = render(<ActivityLogView organizationId="org-1" />);

    const filter = screen.getByRole('button', { name: /filter/i });
    expect(filter).toBeEnabled();

    await user.click(filter);
    if (screen.queryAllByRole('radio').length === 0) {
      await user.click(screen.getByRole('button', { name: /Period/ }));
    }
    await user.click(screen.getByRole('radio', { name: 'Last 90 days' }));
    expect(
      screen.getByText(
        'Period: Last 90 days. All totals below cover this period.',
      ),
    ).toBeInTheDocument();
  });

  it('is not disabled while the summary loads', () => {
    read.current = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    };
    const { container } = render(<ActivityLogView organizationId="org-1" />);
    // The loading skeleton masks the whole view — the button sits inert under
    // it, out of the accessibility tree — so it is found by its label; the
    // filter itself must not be disabled on top of that.
    const filter = container.querySelector('button[aria-label="Filter"]');
    expect(filter).not.toBeNull();
    expect(filter).toBeEnabled();
  });
});

it('shows a retry state instead of fabricated zero totals when the summary fails', async () => {
  const refetch = vi.fn();
  read.current = { data: undefined, isLoading: false, isError: true, refetch };
  const { user } = render(<ActivityLogView organizationId="org-1" />);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Couldn’t load activity summary. Try again.',
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalledOnce();
});
