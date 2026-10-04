import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { EnterpriseSsoSettings } from './enterprise-sso-settings';

const read = vi.hoisted(() => ({ isLoading: true, error: undefined }));

vi.mock('../hooks/use-enterprise-sso', () => ({
  useEnterpriseSso: () => ({
    data: read.isLoading ? undefined : { configured: false },
    isLoading: read.isLoading,
    error: read.error,
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
    read.error = undefined;
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

  it('shows a repair state when the saved connection cannot be read', () => {
    read.isLoading = false;
    read.error = new Error(
      'The SSO connection configuration for acme could not be read; repair connection.yml before continuing.',
    );
    render(<EnterpriseSsoSettings organizationId="org-1" />);

    expect(
      screen.getByText('Saved SSO connection needs repair'),
    ).toBeInTheDocument();
    expect(screen.getByText(/repair connection\.yml/)).toBeInTheDocument();
    expect(screen.queryByText('Connection form')).toBeNull();
  });
});
