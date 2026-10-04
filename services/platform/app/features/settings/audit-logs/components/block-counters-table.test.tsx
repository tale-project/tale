import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { BlockCountersTable } from './block-counters-table';

const queryState = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as Error | null,
  isLoading: false,
  refetch: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => queryState,
}));

describe('BlockCountersTable', () => {
  beforeEach(() => {
    queryState.data = undefined;
    queryState.error = null;
    queryState.isLoading = false;
    queryState.refetch.mockReset();
  });

  it('shows a localized read error and retry instead of the empty state', async () => {
    queryState.error = new Error('service unavailable');

    const { container, user } = render(
      <BlockCountersTable organizationId="org-1" />,
    );

    expect(
      screen.getByRole('heading', {
        name: /Something went wrong\. Try again\./,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No sign-in blocks')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(queryState.refetch).toHaveBeenCalledOnce();
    await checkAccessibility(container);
  });

  it('keeps the no-blocks copy for a successful empty response', () => {
    queryState.data = [];

    render(<BlockCountersTable organizationId="org-1" />);

    expect(screen.getByText('No sign-in blocks')).toBeInTheDocument();
    expect(
      screen.getByText('No rejected sign-in attempts in the last 7 days.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });
});
