import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { EnterpriseSsoSettings } from './enterprise-sso-settings';

const read = vi.hoisted(() => ({ isLoading: true }));

vi.mock('../hooks/use-enterprise-sso', () => ({
  useEnterpriseSso: () => ({
    data: read.isLoading ? undefined : { configured: false },
    isLoading: read.isLoading,
  }),
}));

// The form is tested on its own; here it only has to show where it sits.
vi.mock('./enterprise-sso-form', () => ({
  EnterpriseSsoForm: () => <p>Connection form</p>,
}));
vi.mock(
  '@/app/features/settings/trusted-headers/components/trusted-headers-section',
  () => ({ TrustedHeadersSection: () => null }),
);
vi.mock(
  '@/app/features/settings/trusted-headers/components/embedding-section',
  () => ({ EmbeddingSection: () => null }),
);
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

describe('EnterpriseSsoSettings', () => {
  beforeEach(() => {
    read.isLoading = true;
  });

  it('masks the connection form in place while it loads', () => {
    render(<EnterpriseSsoSettings organizationId="org-1" />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toContainElement(screen.getByText('Connection form'));
  });

  it('shows the form unmasked once the connection has loaded', () => {
    read.isLoading = false;
    render(<EnterpriseSsoSettings organizationId="org-1" />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Connection form')).toBeInTheDocument();
  });
});
