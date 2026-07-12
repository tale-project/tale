import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ReleaseHistorySection } from './release-history-section';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface HistoryRowFixture {
  _id: string;
  organizationId: string;
  holdId: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
  reason: string;
  status: 'effected' | 'rejected' | 'approved' | 'pending';
}

function historyRow(id: string): HistoryRowFixture {
  return {
    _id: id,
    organizationId: 'org-1',
    holdId: `hold-${id}`,
    requestedBy: 'user-1',
    requestedByName: 'Alice',
    requestedAt: Date.now(),
    reason: 'Case closed',
    status: 'effected',
  };
}

let mockResults: HistoryRowFixture[] = [];

vi.mock('../hooks/queries', () => ({
  useLegalHoldReleaseRequestsPaginated: () => ({
    results: mockResults,
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

// DataTable reads the org id from the router, which has no provider in jsdom.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// ---------------------------------------------------------------------------
// #2646: the "Showing all N {entity}" footer must read the correct singular
// noun ("release", not "releases") when exactly one row is visible.
// ---------------------------------------------------------------------------
describe('ReleaseHistorySection entity count footer (#2646)', () => {
  it('reads the singular noun for exactly one release', () => {
    mockResults = [historyRow('1')];
    render(<ReleaseHistorySection organizationId="org-1" />);
    expect(screen.getByText('Showing all 1 release')).toBeInTheDocument();
  });

  it('reads the plural noun for more than one release', () => {
    mockResults = [historyRow('1'), historyRow('2'), historyRow('3')];
    render(<ReleaseHistorySection organizationId="org-1" />);
    expect(screen.getByText('Showing all 3 releases')).toBeInTheDocument();
  });
});
