import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

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
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

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

  it.each(['failed', 'empty', 'rows'] as const)(
    'keeps keyboard focus through loading and recovery to %s',
    async (outcome) => {
      queryState.error = new Error('service unavailable');
      const { rerender, user } = render(
        <BlockCountersTable organizationId="org-1" />,
      );
      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard('{Enter}');
      expect(queryState.refetch).toHaveBeenCalledOnce();
      queryState.error = null;
      queryState.isLoading = true;
      rerender(<BlockCountersTable organizationId="org-1" />);
      await waitFor(() => {
        expect(document.activeElement).not.toBe(document.body);
      });
      queryState.isLoading = false;
      queryState.error =
        outcome === 'failed' ? new Error('still unavailable') : null;
      queryState.data =
        outcome === 'rows'
          ? [
              {
                _id: 'block-1',
                email: 'member@example.com',
                windowStart: 1700000000000,
                lockoutCount: 1,
                ipLimitCount: 2,
              },
            ]
          : outcome === 'empty'
            ? []
            : undefined;
      rerender(<BlockCountersTable organizationId="org-1" />);
      if (outcome === 'failed') {
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'Try again' }),
          ).toHaveFocus(),
        );
      } else {
        await waitFor(() =>
          expect(
            screen.getByRole('region', { name: 'Sign-in block activity' }),
          ).toHaveFocus(),
        );
      }
    },
  );

  it.each(['failed', 'ready'] as const)(
    'preserves a deliberate focus move while retrying to %s',
    async (outcome) => {
      queryState.error = new Error('service unavailable');
      const view = (
        <>
          <button type="button">Other control</button>
          <BlockCountersTable organizationId="org-1" />
        </>
      );
      const { rerender, user } = render(view);
      screen.getByRole('button', { name: 'Try again' }).focus();
      await user.keyboard('{Enter}');
      queryState.error = null;
      queryState.isLoading = true;
      rerender(
        <>
          <button type="button">Other control</button>
          <BlockCountersTable organizationId="org-1" />
        </>,
      );
      const other = screen.getByRole('button', { name: 'Other control' });
      other.focus();
      await waitFor(() => expect(other).toHaveFocus());
      queryState.isLoading = false;
      queryState.error =
        outcome === 'failed' ? new Error('still unavailable') : null;
      queryState.data = outcome === 'ready' ? [] : undefined;
      rerender(
        <>
          <button type="button">Other control</button>
          <BlockCountersTable organizationId="org-1" />
        </>,
      );
      await waitFor(() => expect(other).toHaveFocus());
    },
  );

  it('hands focus to the named region when a focused error heals without loading', async () => {
    queryState.error = new Error('service unavailable');
    const { rerender } = render(<BlockCountersTable organizationId="org-1" />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    queryState.error = null;
    queryState.data = [];
    rerender(<BlockCountersTable organizationId="org-1" />);
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Sign-in block activity' }),
      ).toHaveFocus(),
    );
  });

  it('does not steal focus when the error heals after the reader moved elsewhere', async () => {
    queryState.error = new Error('service unavailable');
    const { rerender } = render(
      <>
        <button type="button">Other control</button>
        <BlockCountersTable organizationId="org-1" />
      </>,
    );
    const other = screen.getByRole('button', { name: 'Other control' });
    other.focus();
    queryState.error = null;
    queryState.data = [];
    rerender(
      <>
        <button type="button">Other control</button>
        <BlockCountersTable organizationId="org-1" />
      </>,
    );
    await waitFor(() => expect(other).toHaveFocus());
  });

  it.each(['en', 'de', 'fr'])(
    'renders localized failure and recovery labels in %s',
    async (locale) => {
      await i18n.changeLanguage(locale);
      queryState.error = new Error('service unavailable');
      const { container, user } = render(
        <BlockCountersTable organizationId="org-1" />,
      );
      const retryLabel = i18n.t('errors.tryAgain', { ns: 'common' });
      const caption = i18n.t('logs.blockCounters.tableCaption', {
        ns: 'settings',
      });
      const emptyTitle = i18n.t('logs.blockCounters.emptyTitle', {
        ns: 'settings',
      });
      expect(screen.getByRole('region', { name: caption })).toBeInTheDocument();
      expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: retryLabel }));
      expect(queryState.refetch).toHaveBeenCalledOnce();
      await checkAccessibility(container);
    },
  );

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
