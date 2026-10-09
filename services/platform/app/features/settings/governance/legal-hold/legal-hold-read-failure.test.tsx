import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { ActiveHoldsSection } from './active-holds-section';
import { ReleaseHistorySection } from './release-history-section';
import { ReleaseRequestsSection } from './release-requests-section';

const mocks = vi.hoisted(() => ({
  holds: vi.fn(),
  requests: vi.fn(),
  history: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useLegalHolds: mocks.holds,
  useLegalHoldReleaseRequests: mocks.requests,
  useLegalHoldReleaseRequestsPaginated: mocks.history,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'operator-1' } }),
}));
vi.mock('./place-hold-dialog', () => ({ PlaceHoldDialog: () => null }));
vi.mock('./request-release-dialog', () => ({
  RequestReleaseDialog: () => null,
}));
vi.mock('./approve-release-dialog', () => ({
  ApproveReleaseDialog: () => null,
}));
vi.mock('./reject-release-dialog', () => ({ RejectReleaseDialog: () => null }));

const row = {
  _id: 'hold-1',
  organizationId: 'org-1',
  targetType: 'org',
  targetId: 'org-1',
  targetLabel: 'Preserved organization',
  reason: 'Preserve litigation evidence',
  placedBy: 'user-1',
  placedByName: 'Alice',
  placedAt: 1_700_000_000_000,
  holdId: 'hold-1',
  requestedBy: 'user-1',
  requestedByName: 'Alice',
  requestedAt: 1_700_000_000_000,
  status: 'effected',
};

function query() {
  return {
    data: undefined as (typeof row)[] | undefined,
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    errorUpdateCount: 0,
  };
}

let holds = query();
let pending = query();
let approved = query();
let history = {
  results: [] as (typeof row)[],
  error: null as Error | null,
  status: 'Exhausted',
  isLoading: false,
  isRetrying: false,
  errorCount: 0,
  loadMore: vi.fn(),
  retry: vi.fn(),
};

beforeEach(() => {
  holds = query();
  pending = query();
  approved = query();
  pending.data = [];
  approved.data = [];
  history = {
    results: [],
    error: null,
    status: 'Exhausted',
    isLoading: false,
    isRetrying: false,
    errorCount: 0,
    loadMore: vi.fn(),
    retry: vi.fn(),
  };
  mocks.holds.mockImplementation(() => holds);
  mocks.requests.mockImplementation((_organizationId, status) =>
    status === 'pending' ? pending : approved,
  );
  mocks.history.mockImplementation(() => history);
});

const lists = ['active', 'pending', 'approved', 'history'] as const;
type List = (typeof lists)[number];

function listName(list: List) {
  if (list === 'active') return 'Active holds';
  if (list === 'history') return 'Release history';
  return list === 'pending'
    ? 'Pending approval'
    : 'Approved (awaiting cooldown)';
}

describe.each(lists)('Legal-hold %s keyboard recovery (B1)', (list) => {
  it.each(['initial', 'cached'] as const)(
    'preserves focus moved after the %s error unmounts but before handoff',
    async (source) => {
      setState(list, source === 'initial' ? 'failure' : 'refetch');
      if (source === 'cached') {
        if (list === 'history') history.error = new Error('cached 503');
        else
          (list === 'active'
            ? holds
            : list === 'pending'
              ? pending
              : approved
          ).error = new Error('cached 503');
      }
      const content = () => (
        <>
          <button type="button">Outside list</button>
          {section(list)}
        </>
      );
      const { rerender } = render(content());
      const outside = screen.getByRole('button', { name: 'Outside list' });
      listView(list).getByRole('button', { name: 'Try again' }).focus();
      setState(list, source === 'initial' ? 'loading' : 'refetch');
      rerender(content());
      expect(document.body).toHaveFocus();
      outside.focus();
      expect(outside).toHaveFocus();
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(outside).toHaveFocus();
      expect(listView(list).queryByText(/^No /)).not.toBeInTheDocument();
    },
  );

  it('hands keyboard retry focus to its named list through loading, repeated failure and success', async () => {
    setState(list, 'failure');
    const { user, rerender } = render(section(list));
    listView(list).getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    setState(list, 'loading');
    rerender(section(list));
    await waitFor(() =>
      expect(document.activeElement).toHaveAccessibleName(listName(list)),
    );
    expect(listView(list).queryByText(/^No /)).not.toBeInTheDocument();
    setState(list, 'failure');
    rerender(section(list));
    expect(document.activeElement).toHaveAccessibleName(listName(list));
    listView(list).getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    setState(list, 'refetch');
    rerender(section(list));
    await waitFor(() =>
      expect(document.activeElement).toHaveAccessibleName(listName(list)),
    );
    expect(
      listView(list).getByText(
        list === 'active' ? row.targetLabel : row.targetId,
      ),
    ).toBeInTheDocument();
  });

  it('keeps cached retry mounted, focusable and inert while busy and hands focus over on recovery', async () => {
    setState(list, 'refetch');
    if (list === 'history') history.error = new Error('cached 503');
    else {
      const target =
        list === 'active' ? holds : list === 'pending' ? pending : approved;
      target.error = new Error('cached 503');
      target.isFetching = false;
    }
    const { user, rerender } = render(section(list));
    const retry = listView(list).getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    retry.focus();
    if (list === 'history') history.isRetrying = true;
    else
      (list === 'active'
        ? holds
        : list === 'pending'
          ? pending
          : approved
      ).isFetching = true;
    rerender(section(list));
    expect(listView(list).getByRole('button', { name: 'Try again' })).toBe(
      retry,
    );
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    const callback =
      list === 'history'
        ? history.retry
        : list === 'active'
          ? holds.refetch
          : list === 'pending'
            ? pending.refetch
            : approved.refetch;
    expect(callback).toHaveBeenCalledTimes(1);
    if (list === 'history') {
      history.isRetrying = false;
      history.error = new Error('repeated cached 503');
      history.errorCount += 1;
    } else {
      const target =
        list === 'active' ? holds : list === 'pending' ? pending : approved;
      target.isFetching = false;
      target.error = new Error('repeated cached 503');
      target.errorUpdateCount += 1;
    }
    rerender(section(list));
    expect(listView(list).getByRole('button', { name: 'Try again' })).toBe(
      retry,
    );
    expect(retry).toHaveFocus();
    expect(retry).not.toHaveAttribute('aria-busy');
    setState(list, 'refetch');
    if (list === 'history') history.isRetrying = false;
    rerender(section(list));
    await waitFor(() =>
      expect(document.activeElement).toHaveAccessibleName(listName(list)),
    );
    expect(listView(list).queryByText(/^No /)).not.toBeInTheDocument();
  });

  it('hands focus to the named list when a passive refresh removes its initial error', async () => {
    setState(list, 'failure');
    const { rerender } = render(section(list));
    listView(list).getByRole('button', { name: 'Try again' }).focus();
    setState(list, 'loading');
    rerender(section(list));
    await waitFor(() =>
      expect(document.activeElement).toHaveAccessibleName(listName(list)),
    );
    expect(listView(list).queryByText(/^No /)).not.toBeInTheDocument();
  });

  it('leaves outside focus alone when cached error recovery removes the notice', async () => {
    setState(list, 'refetch');
    if (list === 'history') history.error = new Error('cached 503');
    else
      (list === 'active'
        ? holds
        : list === 'pending'
          ? pending
          : approved
      ).error = new Error('cached 503');
    const content = () => (
      <>
        <button type="button">Outside list</button>
        {section(list)}
      </>
    );
    const { rerender } = render(content());
    const outside = screen.getByRole('button', { name: 'Outside list' });
    outside.focus();
    setState(list, 'refetch');
    rerender(content());
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(outside).toHaveFocus();
  });

  it.each(['loading', 'refetch'] as const)(
    'does not steal outside focus when the error becomes %s',
    async (next) => {
      setState(list, 'failure');
      const content = () => (
        <>
          <button type="button">Outside list</button>
          {section(list)}
        </>
      );
      const { rerender } = render(content());
      const outside = screen.getByRole('button', { name: 'Outside list' });
      outside.focus();
      setState(list, next);
      rerender(content());
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(outside).toHaveFocus();
    },
  );
});

function section(list: List) {
  if (list === 'active') return <ActiveHoldsSection organizationId="org-1" />;
  if (list === 'history')
    return <ReleaseHistorySection organizationId="org-1" />;
  return <ReleaseRequestsSection organizationId="org-1" />;
}

function listView(list: List) {
  if (list === 'pending' || list === 'approved') {
    const label = screen
      .getAllByText(
        list === 'pending'
          ? 'Pending approval'
          : 'Approved (awaiting cooldown)',
      )
      .find((element) => element.tagName !== 'CAPTION');
    const container = label?.parentElement;
    if (!container) throw new Error('Missing release queue container');
    return within(container);
  }
  return screen;
}

function setState(
  list: List,
  state: 'failure' | 'loading' | 'empty' | 'refetch',
) {
  const error = state === 'failure' ? new Error('synthetic 503') : null;
  if (list === 'history') {
    history.error = error;
    history.results = state === 'refetch' ? [row] : [];
    history.status = state === 'loading' ? 'LoadingFirstPage' : 'Exhausted';
    history.isLoading = state === 'loading';
    return;
  }
  const target =
    list === 'active' ? holds : list === 'pending' ? pending : approved;
  target.error = error;
  target.isError = error !== null;
  target.data =
    state === 'empty' ? [] : state === 'refetch' ? [row] : undefined;
  target.isLoading = state === 'loading';
  target.isFetching = state === 'loading' || state === 'refetch';
}

describe.each(lists)('Legal-hold %s list read states (#3818)', (list) => {
  it('shows a settled failure instead of empty copy and retries only its query', async () => {
    setState(list, 'failure');
    const { user, rerender } = render(section(list));
    const view = listView(list);
    expect(view.queryByText(/^No /)).not.toBeInTheDocument();
    expect(
      view.getByRole('heading', { name: /^Something went wrong/ }),
    ).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'Try again' }));
    expect(holds.refetch).toHaveBeenCalledTimes(list === 'active' ? 1 : 0);
    expect(pending.refetch).toHaveBeenCalledTimes(list === 'pending' ? 1 : 0);
    expect(approved.refetch).toHaveBeenCalledTimes(list === 'approved' ? 1 : 0);
    expect(history.retry).toHaveBeenCalledTimes(list === 'history' ? 1 : 0);
    setState(list, 'empty');
    rerender(section(list));
    expect(
      listView(list).queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(listView(list).getByText(/^No /)).toBeInTheDocument();
  });

  it('does not claim an empty list before the first response', () => {
    setState(list, 'loading');
    render(section(list));
    expect(listView(list).queryByText(/^No /)).not.toBeInTheDocument();
  });

  it('keeps loaded rows visible during a background refetch', () => {
    setState(list, 'refetch');
    render(section(list));
    expect(
      listView(list).getByText(
        list === 'active' ? row.targetLabel : row.targetId,
      ),
    ).toBeInTheDocument();
    expect(listView(list).queryByText(/^No /)).not.toBeInTheDocument();
  });

  it('keeps cached rows and recovery visible after a refetch fails', () => {
    setState(list, 'refetch');
    const error = new Error('synthetic refetch 503');
    if (list === 'history') history.error = error;
    else if (list === 'active') holds.error = error;
    else if (list === 'pending') pending.error = error;
    else approved.error = error;
    render(section(list));
    const view = listView(list);
    expect(
      view.getByText(list === 'active' ? row.targetLabel : row.targetId),
    ).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(view.queryByText(/^No /)).not.toBeInTheDocument();
    if (list === 'history')
      expect(view.queryByText(/^Showing all /)).not.toBeInTheDocument();
  });
});
