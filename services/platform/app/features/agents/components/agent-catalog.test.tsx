// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

// `t(key)` echoes `key` so assertions read against the literal catalog keys
// (no English coupling), and interpolates `{param}` tokens.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            key,
          )
        : key,
  }),
}));

// The catalog reads `useTranslation().i18n.language` for locale resolution; the
// render harness initializes the real i18n at locale `en`, so the unmocked
// hook returns `en` and we let the real provider supply `changeLanguage`.

// Identity locale resolution — the test agents already carry top-level fields.
vi.mock('@/lib/shared/utils/resolve-agent-locale', () => ({
  resolveAgentLocale: (a: { displayName?: string; description?: string }) => ({
    displayName: a.displayName,
    description: a.description,
  }),
}));

const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (args: { title: string; variant?: string; description?: string }) =>
    mockToast(args),
}));

interface MockAgent {
  name: string;
  displayName?: string;
  description?: string;
  folder?: string;
  uiConfigurable?: boolean;
  metadata?: Record<string, unknown>;
}

let mockAgents: MockAgent[] | undefined = [];
let mockAgentsLoading = false;
let mockAgentsError: Error | null = null;
const mockRefetch = vi.fn();
let mockInstallStates: Array<{
  agentSlug: string;
  enabled: boolean;
  installedBy: string;
}> = [];

vi.mock('../hooks/queries', () => ({
  useListAgents: () => ({
    agents: mockAgents,
    isLoading: mockAgentsLoading,
    error: mockAgentsError,
    refetch: mockRefetch,
  }),
  useAgentInstallations: () => ({ data: mockInstallStates }),
}));

const mockInstall = vi.fn();
const mockSetEnabled = vi.fn();
const mockUninstall = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useInstallCatalogAgent: () => ({ mutateAsync: mockInstall }),
  useSetAgentEnabled: () => ({ mutateAsync: mockSetEnabled }),
  useUninstallAgent: () => ({ mutateAsync: mockUninstall }),
}));

import { AgentCatalog } from './agent-catalog';

const ROSTER = [
  {
    name: 'sales-rep',
    displayName: 'Sales Rep',
    description: 'Handles outreach.',
    folder: 'workforce',
    metadata: { labels: ['Sales'] },
  },
] satisfies MockAgent[];

beforeEach(() => {
  vi.clearAllMocks();
  mockAgents = ROSTER;
  mockAgentsLoading = false;
  mockAgentsError = null;
  mockInstallStates = [];
  mockInstall.mockResolvedValue(undefined);
  mockSetEnabled.mockResolvedValue(undefined);
  mockUninstall.mockResolvedValue(undefined);
});

describe('AgentCatalog', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<AgentCatalog organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });

  it('renders a loading skeleton while the roster loads', () => {
    mockAgents = undefined;
    mockAgentsLoading = true;
    render(<AgentCatalog organizationId="org-1" />);
    // The Skeletonize wrapper announces the loading region once.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a retry-able error state when the roster read fails', async () => {
    mockAgentsError = new Error('boom');
    const { user } = render(<AgentCatalog organizationId="org-1" />);
    expect(screen.getByText('loadError.title')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'loadError.retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows the empty state when no agents are available', () => {
    mockAgents = [];
    render(<AgentCatalog organizationId="org-1" />);
    expect(screen.getByText('empty.title')).toBeInTheDocument();
  });

  it('shows the no-results state when a search matches nothing', async () => {
    const { user } = render(<AgentCatalog organizationId="org-1" />);
    await user.type(
      screen.getByPlaceholderText('searchPlaceholder'),
      'zzz-nomatch',
    );
    expect(screen.getByText('noResults.title')).toBeInTheDocument();
  });

  it('exposes only the sr-only "available" status for a not-yet-installed agent', () => {
    render(<AgentCatalog organizationId="org-1" />);
    expect(screen.queryByText('status.enabled')).not.toBeInTheDocument();
    expect(screen.queryByText('status.disabled')).not.toBeInTheDocument();
    // The icon's status dot is decorative; its text twin is sr-only.
    expect(screen.getByText('status.available')).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'install' })).toBeInTheDocument();
  });

  it('installs an available agent and toasts success', async () => {
    const { user } = render(<AgentCatalog organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'install' }));
    await waitFor(() =>
      expect(mockInstall).toHaveBeenCalledWith({
        organizationId: 'org-1',
        agentSlug: 'sales-rep',
      }),
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'installed' });
  });

  it('toasts the catalog error message (only once) when a write fails', async () => {
    mockInstall.mockRejectedValueOnce(new Error('denied'));
    const { user } = render(<AgentCatalog organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'install' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'error', variant: 'destructive' }),
    );
  });

  it('shows the category filter in the filter panel and a category badge on each card', async () => {
    const { user } = render(<AgentCatalog organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: /filter/i }));
    await user.click(
      screen.getByRole('button', { name: /categoryFilter\.title/i }),
    );
    expect(
      screen.getByRole('radio', { name: 'categoryFilter.agent' }),
    ).toBeInTheDocument();
    expect(screen.getByText('categoryBadge.agent')).toBeInTheDocument();
  });

  it('toggles enable for an installed-but-disabled agent', async () => {
    mockInstallStates = [
      { agentSlug: 'sales-rep', enabled: false, installedBy: 'user' },
    ];
    const { user } = render(<AgentCatalog organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'enable' }));
    await waitFor(() =>
      expect(mockSetEnabled).toHaveBeenCalledWith({
        organizationId: 'org-1',
        agentSlug: 'sales-rep',
        enabled: true,
      }),
    );
  });
});
