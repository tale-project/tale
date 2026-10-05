import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { PlaceHoldDialog } from './place-hold-dialog';

const { members, matters, place } = vi.hoisted(() => ({
  members: {
    data: undefined as
      | { userId: string; displayName: string; email: string }[]
      | undefined,
    isLoading: false,
    isError: true,
    isFetching: false,
    errorUpdateCount: 1,
    error: new Error('Members unavailable'),
    refetch: vi.fn(),
  },
  matters: {
    data: undefined as
      | { _id: string; name: string; caseNumber: string }[]
      | undefined,
    isLoading: false,
    isError: true,
    isFetching: false,
    errorUpdateCount: 1,
    error: new Error('Matters unavailable'),
    refetch: vi.fn(),
  },
  place: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useOrgMembersForPicker: () => members,
  useLegalMatters: () => matters,
}));
vi.mock('../hooks/mutations', () => ({
  usePlaceLegalHold: () => ({ mutateAsync: place, isPending: false }),
  useUpsertLegalMatter: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function dialog() {
  return <PlaceHoldDialog open onOpenChange={vi.fn()} organizationId="org-1" />;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const query of [members, matters]) {
    query.data = undefined;
    query.isError = true;
    query.isLoading = false;
    query.isFetching = false;
    query.errorUpdateCount = 1;
  }
});
afterEach(() => {
  cleanup();
  localStorage.removeItem('user-locale');
});

describe('PlaceHoldDialog picker reads', () => {
  it.each([
    [
      'en-US',
      'Users could not be loaded.',
      'Matters could not be loaded.',
      'Try again',
    ],
    [
      'de-DE',
      'Benutzer konnten nicht geladen werden.',
      'Fälle konnten nicht geladen werden.',
      'Erneut versuchen',
    ],
    [
      'fr-FR',
      'Impossible de charger les utilisateurs.',
      'Impossible de charger les dossiers.',
      'Réessayer',
    ],
  ])(
    'localizes picker failures and retry in %s',
    async (locale, usersText, mattersText, retryText) => {
      localStorage.setItem('user-locale', locale);
      render(dialog());
      expect(await screen.findByText(usersText)).toBeInTheDocument();
      expect(screen.getByText(mattersText)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: retryText })).toHaveLength(
        2,
      );
    },
  );

  it('names each failed read and retries only the affected picker', async () => {
    const { user } = render(dialog());
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('Users could not be loaded.');
    expect(alerts[1]).toHaveTextContent('Matters could not be loaded.');
    expect(screen.getByLabelText('User')).toBeDisabled();
    expect(screen.getByLabelText('Matter')).toBeDisabled();
    expect(screen.queryByText('No matching users.')).not.toBeInTheDocument();
    await user.click(
      within(alerts[0]!).getByRole('button', { name: 'Try again' }),
    );
    expect(members.refetch).toHaveBeenCalledTimes(1);
    expect(matters.refetch).not.toHaveBeenCalled();
    await user.click(
      within(alerts[1]!).getByRole('button', { name: 'Try again' }),
    );
    expect(matters.refetch).toHaveBeenCalledTimes(1);
    expect(place).not.toHaveBeenCalled();
    await checkAccessibility(document.body);
  });

  it('keeps retry focused through pending and repeat failure, then focuses the recovered picker', async () => {
    const { user, rerender } = render(dialog());
    const retry = within(screen.getAllByRole('alert')[0]!).getByRole('button', {
      name: 'Try again',
    });
    await user.click(retry);
    members.isError = false;
    members.isLoading = true;
    members.isFetching = true;
    rerender(dialog());
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    await user.click(retry);
    expect(members.refetch).toHaveBeenCalledTimes(1);
    members.isError = true;
    members.isLoading = false;
    members.isFetching = false;
    members.errorUpdateCount = 2;
    rerender(dialog());
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(members.refetch).toHaveBeenCalledTimes(2);
    members.data = [
      { userId: 'member-1', displayName: 'Ada', email: 'ada@example.test' },
    ];
    members.isError = false;
    rerender(dialog());
    await waitFor(() => expect(screen.getByLabelText('User')).toHaveFocus());
    await user.click(screen.getByLabelText('User'));
    await user.click(await screen.findByRole('option', { name: /Ada/ }));
    expect(screen.getByLabelText('User')).toHaveTextContent('Ada');
  });

  it('allows a custodian hold without an optional matter when only matters failed', async () => {
    members.data = [
      { userId: 'member-1', displayName: 'Ada', email: 'ada@example.test' },
    ];
    members.isError = false;
    const { user } = render(dialog());
    await user.click(screen.getByLabelText('User'));
    await user.click(await screen.findByRole('option', { name: /Ada/ }));
    await user.type(screen.getByLabelText('Reason'), 'Preserve audit evidence');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Place hold' }));
    await waitFor(() =>
      expect(place).toHaveBeenCalledWith({
        organizationId: 'org-1',
        targetType: 'userMembership',
        targetId: 'member-1',
        reason: 'Preserve audit evidence',
        matterRef: undefined,
      }),
    );
  });

  it('keeps successful empty reads distinct from failures', async () => {
    localStorage.setItem('user-locale', 'en-US');
    for (const query of [members, matters]) {
      query.data = [];
      query.isError = false;
      query.errorUpdateCount = 0;
    }
    const { user } = render(dialog());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('User'));
    expect(await screen.findByText('No matching users.')).toBeInTheDocument();
  });

  it('does not expose an initial loading read as an empty choice list', () => {
    for (const query of [members, matters]) {
      query.isError = false;
      query.isLoading = true;
      query.isFetching = true;
      query.errorUpdateCount = 0;
    }
    render(dialog());
    expect(screen.getByLabelText('User')).toBeDisabled();
    expect(screen.getByLabelText('Matter')).toBeDisabled();
    expect(screen.getAllByText('Loading...')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes an open picker rather than presenting a failed refresh as empty choices', async () => {
    members.data = [];
    members.isError = false;
    const { user, rerender } = render(dialog());
    await user.click(screen.getByLabelText('User'));
    expect(await screen.findByText('No matching users.')).toBeInTheDocument();
    members.isError = true;
    members.data = undefined;
    rerender(dialog());
    await waitFor(() =>
      expect(screen.queryByText('No matching users.')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('User')).toBeDisabled();
  });

  it('does not present cached options as current after a failed refresh', () => {
    members.data = [
      { userId: 'member-1', displayName: 'Ada', email: 'ada@example.test' },
    ];
    matters.data = [{ _id: 'matter-1', name: 'Audit', caseNumber: '2026-1' }];
    render(dialog());
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByLabelText('User')).toBeDisabled();
    expect(screen.getByLabelText('Matter')).toBeDisabled();
  });

  it('returns retry focus to a recovered matter picker and restores selection', async () => {
    const { user, rerender } = render(dialog());
    const retry = within(screen.getAllByRole('alert')[1]!).getByRole('button', {
      name: 'Try again',
    });
    await user.click(retry);
    matters.isError = false;
    matters.isLoading = true;
    matters.isFetching = true;
    rerender(dialog());
    expect(retry).toHaveFocus();
    expect(screen.getByLabelText('Matter')).toBeDisabled();
    matters.data = [{ _id: 'matter-1', name: 'Audit', caseNumber: '2026-1' }];
    matters.isLoading = false;
    matters.isFetching = false;
    rerender(dialog());
    await waitFor(() => expect(screen.getByLabelText('Matter')).toHaveFocus());
    await user.click(screen.getByLabelText('Matter'));
    await user.click(await screen.findByRole('option', { name: /Audit/ }));
    expect(screen.getByLabelText('Matter')).toHaveTextContent('Audit');
    expect(screen.getByLabelText('User')).toBeDisabled();
  });

  it('keeps organization-wide holds usable when the member read fails', async () => {
    matters.data = [{ _id: 'matter-1', name: 'Audit', caseNumber: '2026-1' }];
    matters.isError = false;
    const { user } = render(dialog());
    await user.click(screen.getByLabelText('Target type'));
    await user.click(
      await screen.findByRole('option', { name: 'Organization' }),
    );
    expect(
      screen.queryByText('Users could not be loaded.'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Matter')).toBeEnabled();
    await user.type(
      screen.getByLabelText('Type ORG-WIDE HOLD to confirm'),
      'ORG-WIDE HOLD',
    );
    await user.type(screen.getByLabelText('Reason'), 'Preserve audit evidence');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Place hold' }));
    await waitFor(() =>
      expect(place).toHaveBeenCalledWith({
        organizationId: 'org-1',
        targetType: 'org',
        targetId: 'org-1',
        reason: 'Preserve audit evidence',
        matterRef: undefined,
      }),
    );
  });
});
