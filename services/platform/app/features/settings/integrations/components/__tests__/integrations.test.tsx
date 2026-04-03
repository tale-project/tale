// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationListItem } from '../integrations';

import { Integrations } from '../integrations';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock('../sso-card', () => ({
  SSOCard: () => <div data-testid="sso-card">SSO Card</div>,
}));

vi.mock('../integration-panel', () => ({
  IntegrationPanel: () => <div data-testid="integration-panel" />,
}));

vi.mock('../integration-upload/integration-upload-dialog', () => ({
  IntegrationUploadDialog: () => <div data-testid="upload-dialog" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeIntegration(
  overrides: Partial<IntegrationListItem> = {},
): IntegrationListItem {
  return {
    _id: 'test-id',
    slug: 'test-slug',
    title: 'Test Integration',
    description: 'A test integration',
    installed: true,
    authMethod: 'bearer_token',
    operationCount: 5,
    hash: 'abc123',
    ...overrides,
  };
}

const defaultProps = {
  organizationId: 'org-1',
  integrations: [] as IntegrationListItem[],
  ssoProvider: null,
  tab: 'all',
  onTabChange: vi.fn(),
};

describe('Integrations', () => {
  it('renders page header with title and button', () => {
    render(<Integrations {...defaultProps} />);
    expect(screen.getByText('integrations.title')).toBeInTheDocument();
    expect(screen.getByText('integrations.pageSubtitle')).toBeInTheDocument();
    expect(
      screen.getByText('integrations.addCustomIntegration'),
    ).toBeInTheDocument();
  });

  it('renders tabs', () => {
    render(<Integrations {...defaultProps} />);
    expect(screen.getByText('integrations.tabs.all')).toBeInTheDocument();
    expect(screen.getByText('integrations.tabs.connected')).toBeInTheDocument();
  });

  it('renders SSO card on "all" tab', () => {
    render(<Integrations {...defaultProps} tab="all" />);
    expect(screen.getByTestId('sso-card')).toBeInTheDocument();
  });

  it('renders integration cards', () => {
    const integrations = [
      makeIntegration({ slug: 'github', title: 'GitHub' }),
      makeIntegration({ slug: 'slack', title: 'Slack' }),
    ];
    render(<Integrations {...defaultProps} integrations={integrations} />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();
  });

  it('filters integrations by "connected" tab', () => {
    const integrations = [
      makeIntegration({
        slug: 'github',
        title: 'GitHub',
        isActive: true,
      }),
      makeIntegration({
        slug: 'slack',
        title: 'Slack',
        isActive: false,
      }),
    ];
    render(
      <Integrations
        {...defaultProps}
        integrations={integrations}
        tab="connected"
      />,
    );
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('filters integrations by search query', async () => {
    const user = userEvent.setup();
    const integrations = [
      makeIntegration({ slug: 'github', title: 'GitHub' }),
      makeIntegration({ slug: 'slack', title: 'Slack' }),
    ];
    render(<Integrations {...defaultProps} integrations={integrations} />);

    const searchInput = screen.getByPlaceholderText(
      'integrations.searchPlaceholder',
    );
    await user.type(searchInput, 'Git');

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('shows empty state for connected tab when no connected integrations', () => {
    render(<Integrations {...defaultProps} tab="connected" />);
    expect(
      screen.getByText('integrations.empty.connectedTitle'),
    ).toBeInTheDocument();
  });

  it('shows empty search state when search has no results', async () => {
    const user = userEvent.setup();
    const integrations = [makeIntegration({ slug: 'github', title: 'GitHub' })];
    render(<Integrations {...defaultProps} integrations={integrations} />);

    const searchInput = screen.getByPlaceholderText(
      'integrations.searchPlaceholder',
    );
    await user.type(searchInput, 'nonexistent');

    expect(
      screen.getByText('integrations.empty.searchTitle'),
    ).toBeInTheDocument();
  });

  it('calls onTabChange when switching tabs', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Integrations {...defaultProps} onTabChange={onTabChange} />);

    await user.click(screen.getByText('integrations.tabs.connected'));
    expect(onTabChange).toHaveBeenCalledWith('connected');
  });
});
