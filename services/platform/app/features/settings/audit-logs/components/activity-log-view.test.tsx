// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

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

vi.mock('../hooks/queries', () => ({
  useActivitySummary: () => ({ data: SUMMARY, isLoading: false }),
}));

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
