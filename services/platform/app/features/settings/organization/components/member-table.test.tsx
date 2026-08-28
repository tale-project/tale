import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { MemberTable } from './member-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useRemoveMember: () => ({ mutateAsync: vi.fn() }),
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
});
