import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ChatErrorDisplay } from './chat-error-display';

// Toggle per test: whether the current member can manage AI providers
// (owner / admin / developer, via the `developerSettings` ability gate).
let mockCanManageProviders = false;
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (_action: string, subject: string) =>
      subject === 'developerSettings' ? mockCanManageProviders : false,
    cannot: (_action: string, subject: string) =>
      subject === 'developerSettings' ? !mockCanManageProviders : true,
  }),
  useAbilityLoading: () => false,
}));

// The provider-settings link is a TanStack `Link` (via `LinkButton`); stub it
// as a plain anchor whose href echoes the route so tests can assert the deep
// link target without a RouterProvider.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        errorGenerating: 'Something went wrong',
        errorDetailsSummary: 'Technical details',
        errorHintMissingApiKey:
          'No API key is configured for this organization yet.',
        errorHintRateLimited: 'Too many requests. Please wait a moment.',
        openProviderSettings: 'Open provider settings',
        askAdminProviderKey:
          'Ask an admin to add an API key in Settings → AI providers.',
      };
      return translations[key] ?? key;
    },
  }),
}));

// A raw provider error the shared classifier maps to `missing_api_key`.
const MISSING_KEY_ERROR = 'MissingApiKeyError: no key configured';
// A rate-limit error — the actionable provider link must NOT appear.
const RATE_LIMIT_ERROR = 'Error: 429 rate limit exceeded';

describe('ChatErrorDisplay provider-settings link', () => {
  beforeEach(() => {
    mockCanManageProviders = false;
  });

  it('links to provider settings on a missing-key error for a manager', () => {
    mockCanManageProviders = true;
    render(
      <ChatErrorDisplay error={MISSING_KEY_ERROR} organizationId="org-1" />,
    );

    const link = screen.getByRole('link', { name: 'Open provider settings' });
    expect(link).toHaveAttribute('href', '/dashboard/$id/settings/providers');
    expect(
      screen.queryByText(
        'Ask an admin to add an API key in Settings → AI providers.',
      ),
    ).not.toBeInTheDocument();
  });

  it('shows an "ask an admin" hint for a member who cannot manage providers', () => {
    mockCanManageProviders = false;
    render(
      <ChatErrorDisplay error={MISSING_KEY_ERROR} organizationId="org-1" />,
    );

    expect(
      screen.getByText(
        'Ask an admin to add an API key in Settings → AI providers.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open provider settings' }),
    ).not.toBeInTheDocument();
  });

  it('renders no provider action for a non-missing-key error', () => {
    mockCanManageProviders = true;
    render(
      <ChatErrorDisplay error={RATE_LIMIT_ERROR} organizationId="org-1" />,
    );

    expect(
      screen.queryByRole('link', { name: 'Open provider settings' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Ask an admin to add an API key in Settings → AI providers.',
      ),
    ).not.toBeInTheDocument();
  });

  it('omits the provider action when no organization id is available', () => {
    mockCanManageProviders = true;
    render(<ChatErrorDisplay error={MISSING_KEY_ERROR} />);

    expect(
      screen.queryByRole('link', { name: 'Open provider settings' }),
    ).not.toBeInTheDocument();
  });

  it('has no accessibility violations for the manager link', async () => {
    mockCanManageProviders = true;
    const { container } = render(
      <ChatErrorDisplay error={MISSING_KEY_ERROR} organizationId="org-1" />,
    );
    await checkAccessibility(container);
  });
});
