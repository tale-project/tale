import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/use-list-page';
import { toast } from '@tale/ui/use-toast';
import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { MemberTable } from './member-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

const { removeMember } = vi.hoisted(() => ({ removeMember: vi.fn() }));
vi.mock('../hooks/mutations', () => ({
  useRemoveMember: () => ({ mutateAsync: removeMember }),
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

vi.mock('./member-row-actions', () => ({
  MemberRowActions: () => <button type="button">actions</button>,
}));

function makeMember(
  overrides: Partial<Parameters<typeof MemberTable>[0]['members'][0]> = {},
) {
  return {
    _id: 'member-1',
    createdAt: Date.now(),
    organizationId: 'org-1',
    userId: 'user-1',
    email: 'alice@example.com',
    role: 'member',
    displayName: 'Alice',
    ...overrides,
  };
}

// The actions column intentionally uses an empty header (header: ''),
// which is a standard data-table pattern. Disable the empty-table-header
// rule so we still audit all other accessibility concerns.
const axeOptions = {
  rules: { 'empty-table-header': { enabled: false } },
};

describe('MemberTable', () => {
  describe('accessibility', () => {
    it('passes axe audit with members', async () => {
      const { container } = render(
        <MemberTable
          members={[
            makeMember(),
            makeMember({
              _id: 'member-2',
              email: 'bob@example.com',
              displayName: 'Bob',
            }),
          ]}
        />,
      );
      await checkAccessibility(container, axeOptions);
    });

    it('passes axe audit when empty', async () => {
      const { container } = render(<MemberTable members={[]} />);
      await checkAccessibility(container, axeOptions);
    });

    it('passes axe audit when loading', async () => {
      const { container } = render(
        <MemberTable members={[]} isLoading approxRowCount={5} />,
      );
      await checkAccessibility(container, axeOptions);
    });
  });

  // Members used to show ten rows while every other settings list showed
  // twenty; the window is the shared list page size now.
  it('shows the shared list page size before loading more', () => {
    const members = Array.from({ length: DEFAULT_LIST_PAGE_SIZE + 5 }, (_, i) =>
      makeMember({
        _id: `member-${i}`,
        email: `member-${i}@example.com`,
        displayName: `Person ${i}`,
      }),
    );
    render(<MemberTable members={members} />);

    expect(screen.getAllByText(/^Person \d+$/)).toHaveLength(
      DEFAULT_LIST_PAGE_SIZE,
    );
  });

  it('renders the add action as the standard toolbar button', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <MemberTable
        members={[makeMember()]}
        addAction={{ label: 'Add member', icon: Plus, onClick }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  // Each row's remove stays quiet, so the bulk bar's one toast is the batch's
  // only report: it names the first refusal's reason, through
  // `describeFailure`, and never a toast per failed row.
  it('says why a bulk remove was refused, in one toast', async () => {
    removeMember
      .mockRejectedValueOnce(
        new AppError({
          code: 'LAST_ADMIN',
          message: 'An organization needs at least one admin.',
        }),
      )
      .mockRejectedValueOnce(new AppError({ code: 'SOMETHING_ELSE' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = render(
      <MemberTable
        members={[
          makeMember(),
          makeMember({
            _id: 'member-2',
            userId: 'user-2',
            email: 'bob@example.com',
            displayName: 'Bob',
          }),
        ]}
      />,
    );

    const [selectAll] = screen.getAllByRole('checkbox');
    await user.click(selectAll as HTMLElement);
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: /Delete/ }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(removeMember).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast).mock.calls).toEqual([
      [
        {
          title: i18n.t('bulkActions.deleteFailed', { ns: 'common' }),
          description: 'An organization needs at least one admin.',
          variant: 'destructive',
        },
      ],
    ]);
  });
});
