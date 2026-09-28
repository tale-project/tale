import { pickFilterOption } from '@tale/ui/testing/filters';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { RequestsListSection } from './requests-list-section';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

// DataTable reads the org id from the router, which has no provider in jsdom.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// The dialog's form reaches for mutations; only the list is under test.
vi.mock('./file-request-dialog', () => ({
  FileRequestDialog: () => null,
}));

// The requests on file, steered per test. A status filter narrows them on the
// server, so a picked status answers `filtered` instead; `failed` settles the
// read as a failed first page.
const store = vi.hoisted(() => ({
  status: 'Exhausted' as 'LoadingFirstPage' | 'Exhausted',
  all: [] as unknown[],
  filtered: [] as unknown[],
  failed: false,
}));
vi.mock('./hooks/queries', () => ({
  useListErasureRequests: (args: { statuses?: string[] }) => ({
    results:
      store.status === 'LoadingFirstPage' || store.failed
        ? []
        : (args.statuses ?? []).length > 0
          ? store.filtered
          : store.all,
    status: store.status,
    isLoading: store.status === 'LoadingFirstPage',
    loadMore: vi.fn(),
    error: store.failed ? new Error('Request timed out') : null,
    retry: vi.fn(),
  }),
}));

const REQUEST = {
  _id: 'req-1',
  organizationId: 'org-1',
  targetUserId: 'user-2',
  targetUserName: 'Ada Lovelace',
  requestedBy: 'user-1',
  requestedByName: 'Grace Hopper',
  requestedAt: Date.now(),
  status: 'done',
  slaDeadlineAt: Date.now() + 86_400_000,
};

beforeEach(() => {
  store.status = 'Exhausted';
  store.all = [REQUEST];
  store.filtered = [];
  store.failed = false;
});

const filterButton = () => screen.getByRole('button', { name: 'Filter' });

describe('RequestsListSection filter', () => {
  it('is offered over requests on file', () => {
    render(<RequestsListSection organizationId="org-1" />);
    expect(filterButton()).toBeEnabled();
  });

  it('is disabled while no request is on file and no status is picked', () => {
    store.all = [];
    render(<RequestsListSection organizationId="org-1" />);
    expect(filterButton()).toBeDisabled();
  });

  it('stays usable while the first page loads', () => {
    store.status = 'LoadingFirstPage';
    render(<RequestsListSection organizationId="org-1" />);
    expect(filterButton()).toBeEnabled();
  });

  it('stays usable when the requests failed to load, since they are unknown', () => {
    store.failed = true;
    render(<RequestsListSection organizationId="org-1" />);
    expect(filterButton()).toBeEnabled();
  });

  it('stays usable when a picked status narrows the list to nothing', async () => {
    const { user } = render(<RequestsListSection organizationId="org-1" />);
    await pickFilterOption(user, 'Status', 'Pending');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(filterButton()).toBeEnabled();
  });
});
