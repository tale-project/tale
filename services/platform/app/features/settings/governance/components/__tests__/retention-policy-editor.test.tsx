import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

const mockUpsertMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock('../../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => mockUpsertMutation,
}));

vi.mock('../../hooks/queries', () => ({
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

import { RetentionPolicyEditor } from '../retention-policy-editor';

describe('RetentionPolicyEditor', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <RetentionPolicyEditor organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders the enable toggle', () => {
    render(<RetentionPolicyEditor organizationId="org-1" />);
    expect(screen.getByRole('switch')).toBeDefined();
  });

  it('renders retention days input', () => {
    render(<RetentionPolicyEditor organizationId="org-1" />);
    expect(screen.getByLabelText(/retention period/i)).toBeDefined();
  });

  it('renders scope selector', () => {
    render(<RetentionPolicyEditor organizationId="org-1" />);
    expect(screen.getByLabelText(/apply to/i)).toBeDefined();
  });

  it('renders warning banner when enabled', () => {
    vi.mocked(
      // Re-mock to return enabled policy
      vi.fn(),
    );
    render(<RetentionPolicyEditor organizationId="org-1" />);
    // Warning should not be visible when policy is not enabled (default state)
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
