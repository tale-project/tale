import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { EnterpriseSsoSettings } from './enterprise-sso-settings';

const read = vi.hoisted((): { isLoading: boolean; error?: Error } => ({
  isLoading: true,
}));
const refetch = vi.hoisted(() => vi.fn());

// The parts of the query result the page reads; a failed read never
// answered (`readStateOf` reads it as unavailable).
vi.mock('../hooks/use-enterprise-sso', () => ({
  useEnterpriseSso: () => ({
    data:
      read.isLoading || read.error !== undefined
        ? undefined
        : { configured: false },
    isLoading: read.isLoading,
    isError: read.error !== undefined,
    error: read.error ?? null,
    isFetching: read.isLoading,
    errorUpdateCount: read.error === undefined ? 0 : 1,
    refetch,
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
    refetch.mockClear();
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

  it('names a saved connection it cannot read, with its repair words and Try again', async () => {
    read.isLoading = false;
    read.error = new Error(
      'The SSO connection configuration for acme could not be read; repair connection.yml before continuing.',
    );
    const { user } = render(<EnterpriseSsoSettings organizationId="org-1" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the SSO connection.");
    expect(alert).toHaveTextContent(/repair connection\.yml/);
    expect(screen.queryByText('Connection form')).toBeNull();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
