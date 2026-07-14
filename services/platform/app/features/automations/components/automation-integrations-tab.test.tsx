// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutomationSummary } from '../hooks/use-automations';
import { AutomationIntegrationsTab } from './automation-integrations-tab';

const navigateMock = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock(
  '@/app/features/settings/integrations/components/integration-panel',
  () => ({
    IntegrationPanel: ({ open }: { open: boolean }) =>
      open ? <div data-testid="integration-panel" /> : null,
  }),
);

vi.mock('./install-wizard/automation-install-wizard', () => ({
  AutomationInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="connect-wizard" /> : null,
}));

let mockRequired: {
  slug: string;
  integration: Record<string, unknown>;
  connected: boolean;
  exists: boolean;
}[] = [];

vi.mock('../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: () => ({
    required: mockRequired,
    blockedSlugs: [],
    isLoading: false,
  }),
}));

vi.mock('../hooks/use-automation-text', () => ({
  useAutomationDisplay: () => () => ({ name: 'Reply to emails' }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockRequired = [];
});

function automationSummary(
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    slug: 'reply-smtp-imap',
    name: 'Sync emails via SMTP/IMAP',
    description: 'Reply via IMAP/SMTP',
    scope: 'org',
    requiredIntegrations: ['smtp-imap'],
    ...overrides,
  } as AutomationSummary;
}

const defaultProps = {
  organizationId: 'org-1',
  automationSlug: 'reply-smtp-imap',
  automation: automationSummary(),
};

describe('AutomationIntegrationsTab', () => {
  it('opens IntegrationPanel for a connected integration instead of navigating away', async () => {
    const user = userEvent.setup();
    mockRequired = [
      {
        slug: 'smtp-imap',
        integration: {
          _id: 'smtp-imap',
          slug: 'smtp-imap',
          name: 'smtp-imap',
          title: 'IMAP / SMTP Mailbox',
          organizationId: 'org-1',
          isActive: true,
          status: 'active',
        },
        connected: true,
        exists: true,
      },
    ];

    render(<AutomationIntegrationsTab {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: 'IMAP / SMTP Mailbox' }),
    );

    expect(screen.getByTestId('integration-panel')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('opens the connect wizard for an unconnected integration', async () => {
    const user = userEvent.setup();
    mockRequired = [
      {
        slug: 'smtp-imap',
        integration: {
          _id: 'smtp-imap',
          slug: 'smtp-imap',
          name: 'smtp-imap',
          title: 'IMAP / SMTP Mailbox',
          organizationId: 'org-1',
        },
        connected: false,
        exists: true,
      },
    ];

    render(<AutomationIntegrationsTab {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: 'IMAP / SMTP Mailbox' }),
    );

    expect(screen.getByTestId('connect-wizard')).toBeInTheDocument();
    expect(screen.queryByTestId('integration-panel')).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
