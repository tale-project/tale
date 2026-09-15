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
  storage: { data: undefined as unknown, isLoading: false },
  canReadOrgSettings: false,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyBudgetUsage: () => state.budget,
}));

vi.mock('@/app/features/documents/hooks/queries', () => ({
  useUploadUsage: () => state.storage,
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
    className,
  }: {
    children: ReactNode;
    to: string;
    params: { id: string };
    className?: string;
  }) => (
    <a href={to.replace('$id', params.id)} className={className}>
      {children}
    </a>
  ),
}));

const RESETS_AT = Date.UTC(2026, 9, 1);

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
    };
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
    state.storage.data = {
      limited: true,
      usedBytes: 1.5 * 1024 ** 3,
      limitBytes: 10 * 1024 ** 3,
    };

    render(<UsageSettings organizationId="org-1" />);

    const storage = section('Storage');
    expect(within(storage).getByText('Uploaded files')).toBeInTheDocument();
    expect(within(storage).getByText('1.5 GB of 10 GB')).toBeInTheDocument();
  });

  it('states when no storage limit applies', () => {
    render(<UsageSettings organizationId="org-1" />);

    expect(
      within(section('Storage')).getByText('No storage limit applies to you.'),
    ).toBeInTheDocument();
  });

  it('masks the meters in place while loading', () => {
    state.budget = { data: undefined, isLoading: true, isError: false };
    state.storage = { data: undefined, isLoading: true };

    render(<UsageSettings organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'Your limits' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Uploaded files')).toBeInTheDocument();
    expect(screen.queryByText('No usage limits apply to you')).toBeNull();
    expect(screen.queryByText('No storage limit applies to you.')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('passes an accessibility audit with personal and shared meters', async () => {
    state.canReadOrgSettings = true;
    state.budget.data = [
      limit({ costCents: { used: 1_240, limit: 5_000 } }),
      limit({ scope: 'org', tokens: { used: 5, limit: 10 } }),
    ];
    state.storage.data = {
      limited: true,
      usedBytes: 1024,
      limitBytes: 1024 ** 3,
    };

    const { container } = render(<UsageSettings organizationId="org-1" />);

    await checkAccessibility(container);
  });
});
