import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { MemberTable } from './member-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
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
          sortOrder="asc"
          onSortChange={vi.fn()}
        />,
      );
      await checkAccessibility(container, axeOptions);
    });

    it('passes axe audit when empty', async () => {
      const { container } = render(
        <MemberTable members={[]} sortOrder="asc" onSortChange={vi.fn()} />,
      );
      await checkAccessibility(container, axeOptions);
    });

    it('passes axe audit when loading', async () => {
      const { container } = render(
        <MemberTable
          members={[]}
          sortOrder="asc"
          onSortChange={vi.fn()}
          isLoading
          approxRowCount={5}
        />,
      );
      await checkAccessibility(container, axeOptions);
    });
  });
});
