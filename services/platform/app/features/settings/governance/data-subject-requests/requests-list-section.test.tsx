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
// read as a failed first page, `failedWithRows` as a read that failed under
// the requests already loaded (a later page, or a refresh).
const store = vi.hoisted(() => ({
  status: 'Exhausted' as 'LoadingFirstPage' | 'CanLoadMore' | 'Exhausted',
  all: [] as unknown[],
  filtered: [] as unknown[],
  failed: false,
  failedWithRows: false,
  errorCount: 0,
  error: new Error('Request timed out'),
  retry: vi.fn(),
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
    error: store.failed || store.failedWithRows ? store.error : null,
    retry: store.retry,
    isRetrying: false,
    unavailable: store.failed,
    errorCount: store.errorCount,
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
  store.failedWithRows = false;
  store.errorCount = 0;
  store.retry = vi.fn();
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

// "No erasure requests yet" over a read that failed invites a duplicate
// erasure request (#4834).
describe('RequestsListSection read failures', () => {
  const emptyTitle = 'No erasure requests yet';

  it('names a failed first page instead of an empty list, and Try again recovers it', async () => {
    store.failed = true;
    store.errorCount = 1;
    const { user, rerender } = render(
      <RequestsListSection organizationId="org-1" />,
    );
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /^Something went wrong/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(store.retry).toHaveBeenCalledTimes(1);
    // The retry asks for the first page again: the table loads, and the
    // focus Try again held waits on the list, not on the page.
    store.failed = false;
    store.status = 'LoadingFirstPage';
    rerender(<RequestsListSection organizationId="org-1" />);
    expect(document.activeElement).toHaveAccessibleName('Requests');
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
    store.status = 'Exhausted';
    rerender(<RequestsListSection organizationId="org-1" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('does not say no request is on file before the first page answers', () => {
    store.status = 'LoadingFirstPage';
    render(<RequestsListSection organizationId="org-1" />);
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
  });

  it('still says no request is on file when the read answered with none', () => {
    store.all = [];
    render(<RequestsListSection organizationId="org-1" />);
    expect(screen.getByText(emptyTitle)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the loaded requests when a later page fails, names the failure and retries that page', async () => {
    store.status = 'CanLoadMore';
    store.failedWithRows = true;
    store.errorCount = 1;
    const { user } = render(<RequestsListSection organizationId="org-1" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the latest erasure requests. What's listed may be incomplete or out of date.",
    );
    expect(screen.getByText(/the rest couldn't be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(store.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps a complete list when its refresh fails, without claiming a rest it could not load', () => {
    store.failedWithRows = true;
    store.errorCount = 1;
    render(<RequestsListSection organizationId="org-1" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the latest erasure requests.",
    );
    expect(
      screen.queryByText(/the rest couldn't be loaded/),
    ).not.toBeInTheDocument();
  });
});
