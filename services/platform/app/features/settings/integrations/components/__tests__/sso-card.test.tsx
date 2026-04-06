// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { SSOCard } from '../sso-card';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock('../sso-config-dialog', () => ({
  SSOConfigDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) =>
    open ? (
      <div data-testid="sso-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null,
}));

afterEach(cleanup);

describe('SSOCard', () => {
  it('renders SSO card with title', () => {
    render(<SSOCard organizationId="org-1" ssoProvider={null} />);
    expect(screen.getByText('integrations.sso.name')).toBeInTheDocument();
    expect(
      screen.getByText('integrations.sso.description'),
    ).toBeInTheDocument();
  });

  it('shows "Connect" badge when no SSO provider', () => {
    render(<SSOCard organizationId="org-1" ssoProvider={null} />);
    expect(screen.getByText('integrations.badge.connect')).toBeInTheDocument();
  });

  it('shows "Connected" badge when SSO provider exists', () => {
    const provider = {
      _id: 'sso-1',
      providerId: 'entra-id',
      issuer: 'https://example.com',
      scopes: ['openid', 'profile'],
      autoProvisionRole: false,
      roleMappingRules: [],
      defaultRole: 'member',
    } satisfies SsoProvider;
    render(<SSOCard organizationId="org-1" ssoProvider={provider} />);
    expect(
      screen.getByText('integrations.badge.connected'),
    ).toBeInTheDocument();
  });

  it('opens dialog on click', async () => {
    const user = userEvent.setup();
    render(<SSOCard organizationId="org-1" ssoProvider={null} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('sso-dialog')).toBeInTheDocument();
  });
});
