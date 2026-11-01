import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { MyBudgetUsageLimit } from '../../governance/hooks/queries';
import { UsageSettings } from './usage-settings';

const state = vi.hoisted(() => ({
  budget: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
  },
  storage: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
  },
  refetchStorage: vi.fn(),
  canReadOrgSettings: false,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyBudgetUsage: () => state.budget,
}));

vi.mock('@/app/features/documents/hooks/queries', () => ({
  useUploadUsage: () => ({ ...state.storage, refetch: state.refetchStorage }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => state.canReadOrgSettings,
    cannot: () => !state.canReadOrgSettings,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    params: Record<string, string>;
    search?: Record<string, string>;
    className?: string;
  }) => {
    const path = Object.entries(params).reduce(
      (href, [key, value]) => href.replace(`$${key}`, value),
      to,
    );
    const query = search ? `?${new URLSearchParams(search).toString()}` : '';
    return (
      <a href={`${path}${query}`} className={className}>
        {children}
      </a>
    );
  },
}));

const RESETS_AT = Date.UTC(2026, 9, 1);
const GB = 1024 ** 3;

/** A metered answer whose parts add up to `usedBytes`, as the server's do. */
function metered(
  usedBytes: number,
  limitBytes: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    limited: true,
    usedBytes,
    limitBytes,
    breakdown: {
      documents: usedBytes,
      agentFiles: 0,
      chatAttachments: 0,
      other: 0,
    },
    chats: [],
    chatCount: 0,
    ...overrides,
  };
}

function limit(overrides: Partial<MyBudgetUsageLimit>): MyBudgetUsageLimit {
  return {
    scope: 'user',
    teamId: null,
    teamName: null,
    period: 'monthly',
    periodKey: '2026-09',
    resetsAt: RESETS_AT,
    warningThresholdPercent: null,
    tokens: null,
    costCents: null,
    requests: null,
    ...overrides,
  };
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('UsageSettings', () => {
  beforeEach(() => {
    state.budget = { data: [], isLoading: false, isError: false };
    state.storage = {
      data: { limited: false, usedBytes: 0, limitBytes: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      errorUpdateCount: 0,
    };
    state.refetchStorage.mockReset();
    state.canReadOrgSettings = false;
  });

  it('separates personal caps from shared ones, each with its usage and reset', () => {
    state.budget.data = [
      limit({
        period: 'daily',
        resetsAt: Date.UTC(2026, 8, 16),
        requests: { used: 38, limit: 60 },
      }),
      limit({
        tokens: { used: 412_300, limit: 1_000_000 },
        costCents: { used: 1_240, limit: 5_000 },
      }),
      limit({
        scope: 'team',
        teamId: 'team-1',
        teamName: 'Design',
        period: 'weekly',
        requests: { used: 260, limit: 400 },
      }),
      limit({ scope: 'org', costCents: { used: 31_000, limit: 50_000 } }),
    ];

    render(<UsageSettings organizationId="org-1" />);

    const personal = section('Your limits');
    expect(within(personal).getByText('Daily requests')).toBeInTheDocument();
    expect(within(personal).getByText('38 of 60')).toBeInTheDocument();
    expect(within(personal).getByText('Monthly tokens')).toBeInTheDocument();
    expect(
      within(personal).getByText('412,300 of 1,000,000'),
    ).toBeInTheDocument();
    expect(
      within(personal).getByRole('progressbar', {
        name: 'Monthly cost: $12.40 of $50.00',
      }),
    ).toHaveAttribute('aria-valuenow', '1240');
    expect(within(personal).getAllByText(/^Resets /)).toHaveLength(3);

    const shared = section('Shared limits');
    expect(within(shared).getByText('Weekly requests')).toBeInTheDocument();
    expect(
      within(shared).getByText(/^Design team · resets /),
    ).toBeInTheDocument();
    expect(within(shared).getByText('$310.00 of $500.00')).toBeInTheDocument();
    expect(
      within(shared).getByText(/^Entire organization · resets /),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No usage limits apply to you'),
    ).not.toBeInTheDocument();
  });

  it('tints a meter at its warning threshold and marks a reached cap', () => {
    state.budget.data = [
      limit({
        warningThresholdPercent: 80,
        costCents: { used: 4_200, limit: 5_000 },
        requests: { used: 30, limit: 100 },
      }),
      limit({
        scope: 'org',
        period: 'daily',
        tokens: { used: 1_000_000, limit: 1_000_000 },
      }),
    ];

    render(<UsageSettings organizationId="org-1" />);

    const bar = (name: string) =>
      screen.getByRole('progressbar', { name }).firstElementChild;
    expect(bar('Monthly cost: $42.00 of $50.00')).toHaveClass('bg-warning');
    expect(bar('Monthly requests: 30 of 100')).toHaveClass('bg-primary');
    expect(bar('Daily tokens: 1,000,000 of 1,000,000')).toHaveClass(
      'bg-destructive',
    );
    expect(
      within(section('Shared limits')).getByText('Limit reached'),
    ).toBeInTheDocument();
    expect(
      within(section('Your limits')).queryByText('Limit reached'),
    ).not.toBeInTheDocument();
  });

  it('says so when no budget binds the member', () => {
    render(<UsageSettings organizationId="org-1" />);

    const limits = section('Usage limits');
    expect(
      within(limits).getByText('No usage limits apply to you'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your limits' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('reports a failed read instead of claiming there are no limits', () => {
    state.budget = { data: undefined, isLoading: false, isError: true };

    render(<UsageSettings organizationId="org-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load your usage limits.",
    );
    expect(screen.queryByText('No usage limits apply to you')).toBeNull();
  });

  it('offers the budget rules only to members who can read them', () => {
    state.budget.data = [limit({ requests: { used: 1, limit: 10 } })];
    const { unmount } = render(<UsageSettings organizationId="org-1" />);
    expect(screen.queryByRole('link', { name: 'Manage limits' })).toBeNull();
    unmount();

    state.canReadOrgSettings = true;
    render(<UsageSettings organizationId="org-1" />);
    expect(screen.getByRole('link', { name: 'Manage limits' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/governance/policies-limits',
    );
  });

  it('meters storage against the per-user upload volume', () => {
    state.storage.data = metered(1.5 * GB, 10 * GB);

    render(<UsageSettings organizationId="org-1" />);

    const storage = section('Storage');
    expect(within(storage).getByText('Uploaded files')).toBeInTheDocument();
    expect(within(storage).getByText('1.5 GB of 10 GB')).toBeInTheDocument();
  });

  // #5042: the meter showed a total and nothing of the files behind it.
  it('breaks the meter down by kind and links to where the files live', () => {
    state.storage.data = metered(1.5 * GB, 10 * GB, {
      breakdown: {
        documents: GB,
        agentFiles: 0.25 * GB,
        chatAttachments: 0.25 * GB,
        other: 0,
      },
      chats: [
        { threadId: 'chat-big', title: 'Q3 review', bytes: 0.2 * GB },
        { threadId: 'chat-small', title: null, bytes: 0.05 * GB },
      ],
      chatCount: 3,
    });

    render(<UsageSettings organizationId="org-1" />);

    const storage = section('Storage');
    expect(within(storage).getByText('1.5 GB of 10 GB')).toBeInTheDocument();
    const parts = within(storage).getAllByRole('term');
    expect(parts.map((part) => part.textContent)).toEqual([
      'Documents',
      'Chat attachments',
      'Files made by agents',
    ]);
    expect(parts.map((part) => part.nextElementSibling?.textContent)).toEqual([
      '1 GB',
      '256 MB',
      '256 MB',
    ]);
    expect(
      within(storage).getByRole('link', {
        name: 'View my documents in Knowledge',
      }),
    ).toHaveAttribute('href', '/dashboard/org-1/documents?uploadedBy=me');

    const chats = within(storage).getByRole('list', {
      name: 'Chats that hold your files',
    });
    expect(
      within(chats).getByRole('link', { name: 'Q3 review' }),
    ).toHaveAttribute('href', '/dashboard/org-1/chat/chat-big');
    expect(
      within(chats).getByRole('link', { name: 'Untitled chat' }),
    ).toHaveAttribute('href', '/dashboard/org-1/chat/chat-small');
    expect(within(storage).getByText('and 1 more chat')).toBeInTheDocument();
  });

  it('names other files only when some count', () => {
    state.storage.data = metered(GB, 10 * GB);
    const { unmount } = render(<UsageSettings organizationId="org-1" />);
    expect(within(section('Storage')).queryByText('Other files')).toBeNull();
    expect(
      within(section('Storage')).queryByRole('list', {
        name: 'Chats that hold your files',
      }),
    ).toBeNull();
    unmount();

    state.storage.data = metered(GB, 10 * GB, {
      breakdown: {
        documents: 0.5 * GB,
        agentFiles: 0,
        chatAttachments: 0,
        other: 0.5 * GB,
      },
    });
    render(<UsageSettings organizationId="org-1" />);
    expect(
      within(section('Storage')).getByText('Other files'),
    ).toBeInTheDocument();
  });

  it('states when no storage limit applies', () => {
    render(<UsageSettings organizationId="org-1" />);

    expect(
      within(section('Storage')).getByText('No storage limit applies to you.'),
    ).toBeInTheDocument();
  });

  // #4832: a read that failed said "No storage limit applies to you."
  it('reports a failed storage read, with Try again, instead of claiming no limit applies', async () => {
    state.storage = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      errorUpdateCount: 1,
    };

    const { user, container } = render(
      <UsageSettings organizationId="org-1" />,
    );

    const storage = section('Storage');
    expect(within(storage).getByRole('alert')).toHaveTextContent(
      "Couldn't load your storage usage.",
    );
    expect(screen.queryByText('No storage limit applies to you.')).toBeNull();
    // Nothing about the quota is known: no meter, and nothing masked.
    expect(within(storage).queryByText('Uploaded files')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    await user.click(
      within(storage).getByRole('button', { name: 'Try again' }),
    );
    expect(state.refetchStorage).toHaveBeenCalledTimes(1);
    await checkAccessibility(container);
  });

  it('keeps the failure and a busy Try again on screen while the retry runs', () => {
    // react-query puts a read that never answered back to pending for the
    // retry: not in error, loading, with its failure still counted.
    state.storage = {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      errorUpdateCount: 1,
    };

    render(<UsageSettings organizationId="org-1" />);

    const storage = section('Storage');
    expect(within(storage).getByRole('alert')).toHaveTextContent(
      "Couldn't load your storage usage.",
    );
    expect(
      within(storage).getByRole('button', { name: 'Try again' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No storage limit applies to you.')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the last answer under a notice when a refresh fails', () => {
    state.storage = {
      data: metered(1.5 * GB, 10 * GB),
      isLoading: false,
      isError: true,
      isFetching: false,
      errorUpdateCount: 1,
    };

    render(<UsageSettings organizationId="org-1" />);

    const storage = section('Storage');
    expect(within(storage).getByRole('alert')).toHaveTextContent(
      "Couldn't refresh your storage usage. What's shown may be out of date.",
    );
    expect(within(storage).getByText('1.5 GB of 10 GB')).toBeInTheDocument();
  });

  it('holds the shape most members get, masked, while loading', () => {
    state.budget = { data: undefined, isLoading: true, isError: false };
    state.storage = {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      errorUpdateCount: 0,
    };

    render(<UsageSettings organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'Usage limits' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your limits' })).toBeNull();
    expect(screen.getByText('Uploaded files')).toBeInTheDocument();
    // Masked, never claimed before the read answers.
    expect(screen.queryByText('No usage limits apply to you')).toBeNull();
    expect(screen.queryByText('No storage limit applies to you.')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('keeps the limits section in place when the read finds none', () => {
    state.budget = { data: undefined, isLoading: true, isError: false };
    const { rerender } = render(<UsageSettings organizationId="org-1" />);
    const loading = section('Usage limits');

    state.budget = { data: [], isLoading: false, isError: false };
    rerender(<UsageSettings organizationId="org-1" />);

    expect(section('Usage limits')).toBe(loading);
    expect(
      within(loading).getByText('No usage limits apply to you'),
    ).toBeInTheDocument();
  });

  it('passes an accessibility audit with personal and shared meters', async () => {
    state.canReadOrgSettings = true;
    state.budget.data = [
      limit({ costCents: { used: 1_240, limit: 5_000 } }),
      limit({ scope: 'org', tokens: { used: 5, limit: 10 } }),
    ];
    state.storage.data = metered(GB, 10 * GB, {
      breakdown: {
        documents: 0.5 * GB,
        agentFiles: 0.25 * GB,
        chatAttachments: 0.25 * GB,
        other: 0,
      },
      chats: [{ threadId: 'chat-1', title: 'Q3 review', bytes: 0.25 * GB }],
      chatCount: 1,
    });

    const { container } = render(<UsageSettings organizationId="org-1" />);

    await checkAccessibility(container);
  });
});
