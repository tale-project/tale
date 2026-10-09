import { cloneElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { AutomationRunsTab } from './automation-runs-tab';
import { AutomationVersionPicker } from './automation-version-picker';

const query = vi.hoisted(() => ({
  data: undefined as [] | undefined,
  isPending: false,
  isError: false,
  error: new Error('Network request failed'),
  refetch: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationRuns: () => query,
  useAutomationVersions: () => query,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: undefined }),
}));

const histories = [
  {
    name: 'Runs',
    empty: 'This automation has not run yet.',
    element: <AutomationRunsTab organizationId="org-1" automationSlug="sync" />,
  },
  {
    name: 'Versions',
    empty: 'No versions saved yet.',
    element: (
      <AutomationVersionPicker
        organizationId="org-1"
        automationSlug="sync"
        showHistory
      />
    ),
  },
];

beforeEach(async () => {
  localStorage.setItem('user-locale', 'en');
  await i18n.changeLanguage('en');
  query.data = undefined;
  query.isPending = false;
  query.isError = false;
  query.refetch.mockReset();
});

describe.each(histories)('$name history', ({ element, empty, name }) => {
  it('shows a failed read with a keyboard-reachable retry, never empty history', async () => {
    query.isError = true;
    const { user } = render(element);

    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    expect(retry).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(query.refetch).toHaveBeenCalledOnce();
    expect(
      screen.getByText(
        'Something went wrong while loading this page. Try again or go to another section.',
      ),
    ).toBeVisible();
  });

  it('preserves the successful empty-history copy', async () => {
    query.data = [];
    render(element);

    expect(await screen.findByText(empty)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('does not report cached empty history as success after a failed refetch', async () => {
    query.data = [];
    query.isError = true;
    render(element);

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it('exposes a pending history read without a retry', () => {
    query.isPending = true;
    render(element);

    expect(screen.getByRole('status', { name })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('announces the error and hands retry focus to the history heading on recovery', async () => {
    query.isError = true;
    const { rerender } = render(element);
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: 'Try again' });
    retry.focus();
    query.isError = false;
    query.data = [];
    rerender(cloneElement(element));

    expect(await screen.findByText(empty)).toBeVisible();
    await waitFor(() =>
      expect(screen.getByText(name, { selector: 'span' })).toHaveFocus(),
    );
  });

  it.each([
    ['en', 'Try again', 'Something went wrong. Try again.'],
    ['de', 'Erneut versuchen', 'Etwas ist schiefgelaufen. Versuch es erneut.'],
    ['fr', 'Réessayer', "Une erreur s'est produite. Réessaie."],
  ])(
    'uses the shared localized failure controls in %s',
    async (locale, retryLabel, title) => {
      await i18n.changeLanguage(locale);
      localStorage.setItem('user-locale', locale);
      query.isError = true;
      render(element);

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByRole('heading', { name: title })).toBeVisible();
      expect(
        within(alert).getByRole('button', { name: retryLabel }),
      ).toBeVisible();
      await checkAccessibility(alert);
    },
  );
});
