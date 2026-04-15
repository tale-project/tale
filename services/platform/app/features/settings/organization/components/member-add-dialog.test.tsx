import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { AddMemberDialog } from './member-add-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', async () => {
  const { DEFAULT_PASSWORD_POLICY } =
    await import('@/lib/shared/schemas/governance');
  return {
    usePasswordPolicy: () => DEFAULT_PASSWORD_POLICY,
  };
});

describe('AddMemberDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <AddMemberDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <AddMemberDialog
          organizationId="org-1"
          open={false}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
