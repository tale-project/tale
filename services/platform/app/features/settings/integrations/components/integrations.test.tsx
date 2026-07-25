// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

import type { IntegrationListItem } from './integrations';
import { Integrations } from './integrations';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock('./integration-panel', () => ({
  IntegrationPanel: ({ integration }: { integration: { title?: string } }) => (
    <div data-testid="integration-panel">{integration?.title}</div>
  ),
}));

vi.mock('./integration-upload/integration-upload-dialog', () => ({
  IntegrationUploadDialog: () => <div data-testid="upload-dialog" />,
}));

// The export action wires a Convex hook (no ConvexProvider mounts here).
vi.mock('../hooks/use-export-integration', () => ({
  useExportIntegration: () => ({ mutateAsync: vi.fn() }),
}));

const mockDuplicateAsync = vi.fn();
vi.mock('../hooks/use-duplicate-integration', () => ({
  useDuplicateIntegration: () => ({ mutateAsync: mockDuplicateAsync }),
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
    authMethod: 'bearer_token',
    duplicable: true,
    operationCount: 5,
    hash: 'abc123',
    ...overrides,
  };
}

const defaultProps = {
  organizationId: 'org-1',
  integrations: [] as IntegrationListItem[],
  tab: 'all',
  onTabChange: vi.fn(),
  addDialogOpen: false,
  onAddDialogOpenChange: vi.fn(),
};

describe('Integrations', () => {
  // The page title, subtitle, and "Add integration" trigger now live in the
  // route's `SettingsPage` header; this component renders the tabs + grid only.
  it('renders tabs', () => {
    render(<Integrations {...defaultProps} />);
    expect(screen.getByText('integrations.tabs.all')).toBeInTheDocument();
    expect(screen.getByText('integrations.tabs.connected')).toBeInTheDocument();
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

  it('offers a CTA to browse all integrations from the connected empty state', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <Integrations
        {...defaultProps}
        tab="connected"
        onTabChange={onTabChange}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'integrations.empty.browseAll',
      }),
    );
    expect(onTabChange).toHaveBeenCalledWith('all');
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
      screen.getByText('integrations.noResults.title'),
    ).toBeInTheDocument();
  });

  it('calls onTabChange when switching tabs', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Integrations {...defaultProps} onTabChange={onTabChange} />);

    await user.click(screen.getByText('integrations.tabs.connected'));
    expect(onTabChange).toHaveBeenCalledWith('connected');
  });

  it('duplicating switches to the all tab and opens the new instance once it appears', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    mockDuplicateAsync.mockResolvedValue({
      newSlug: 'imap_smtp-2',
      credentialId: 'c1',
      reboundAutomations: [],
    });
    const source = makeIntegration({
      slug: 'imap_smtp',
      title: 'IMAP / SMTP Mailbox',
      duplicable: true,
    });
    const { rerender } = render(
      <Integrations
        {...defaultProps}
        onTabChange={onTabChange}
        integrations={[source]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'integrations.menuLabel' }),
    );
    await user.click(await screen.findByText('actions.duplicate'));

    // Duplicate fires, then switches to the "all" tab (the new instance is
    // inactive, so it would be hidden on Connected).
    await waitFor(() => {
      expect(mockDuplicateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        slug: 'imap_smtp',
      });
      expect(onTabChange).toHaveBeenCalledWith('all');
    });

    // The new instance arrives on the refetch → its panel opens automatically.
    const duplicate = makeIntegration({
      slug: 'imap_smtp-2',
      title: 'IMAP / SMTP Mailbox (2)',
      duplicable: true,
    });
    rerender(
      <Integrations
        {...defaultProps}
        onTabChange={onTabChange}
        integrations={[source, duplicate]}
      />,
    );
    expect(await screen.findByTestId('integration-panel')).toHaveTextContent(
      'IMAP / SMTP Mailbox (2)',
    );
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Integrations {...defaultProps} />);
      // Radix Tabs renders aria-controls referencing a lazy panel that
      // doesn't exist in JSDOM, causing a false positive.
      await checkAccessibility(container, {
        rules: { 'aria-valid-attr-value': { enabled: false } },
      });
    });
  });
});
