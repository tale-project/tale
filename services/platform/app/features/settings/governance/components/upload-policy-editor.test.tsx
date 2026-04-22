import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

const mockUpsertMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => mockUpsertMutation,
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { UploadPolicyEditor } from './upload-policy-editor';

describe('UploadPolicyEditor', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <UploadPolicyEditor organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders the enable toggle', () => {
    render(<UploadPolicyEditor organizationId="org-1" />);
    expect(screen.getByRole('switch')).toBeDefined();
  });

  it('renders file extension input', () => {
    render(<UploadPolicyEditor organizationId="org-1" />);
    expect(screen.getByLabelText(/allowed file extensions/i)).toBeDefined();
  });

  it('renders max file size input', () => {
    render(<UploadPolicyEditor organizationId="org-1" />);
    expect(screen.getByLabelText(/maximum file size/i)).toBeDefined();
  });

  it('renders max volume input', () => {
    render(<UploadPolicyEditor organizationId="org-1" />);
    expect(screen.getByLabelText(/maximum total volume/i)).toBeDefined();
  });
});
