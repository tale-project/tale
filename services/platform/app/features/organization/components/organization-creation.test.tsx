import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Route } from '@/app/routes/dashboard/create-organization';
import { render, screen } from '@/tests/utils/render';

import { OrganizationListPanel } from './organization-list-panel';

const state = vi.hoisted(() => ({
  canCreate: true as boolean | undefined,
  isLoading: false,
  isError: false,
}));
const retry = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ href: '/dashboard/org-a' }),
}));
vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganizationCapabilities: () => ({
    data:
      state.canCreate === undefined
        ? undefined
        : { canCreate: state.canCreate },
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: retry,
  }),
  useUserOrganizations: () => ({
    isLoading: false,
    isAuthLoading: false,
    isAuthenticated: true,
  }),
  useUserOrganizationsWithDetails: () => ({ organizations: [] }),
}));
vi.mock(
  '@/app/features/organization/components/onboarding/onboarding-wizard',
  () => ({ OnboardingWizard: () => <p>Workspace wizard</p> }),
);
vi.mock('@/app/components/layout/dashboard-shell-frame', () => ({
  DashboardShellFrame: () => <p>Resolving workspace</p>,
}));

const CreatePage = (Route as unknown as { component: ComponentType }).component;
beforeEach(() => {
  state.canCreate = true;
  state.isLoading = false;
  state.isError = false;
  vi.clearAllMocks();
});

describe('deployment-owned organization provisioning', () => {
  it('shows creation controls only when the deployment allows them', () => {
    render(
      <>
        <OrganizationListPanel currentOrganizationId="org-a" />
        <CreatePage />
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'Create organization' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace wizard')).toBeInTheDocument();
  });

  it('hides the picker action and explains operator ownership on a direct wizard URL', () => {
    state.canCreate = false;
    render(
      <>
        <OrganizationListPanel currentOrganizationId="org-a" />
        <CreatePage />
      </>,
    );
    expect(
      screen.queryByRole('button', { name: 'Create organization' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace wizard')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'You cannot create an organization on this deployment. Contact the operator to request a workspace.',
      ),
    ).toBeInTheDocument();
  });

  it('does not flash creation controls while the capability loads', () => {
    state.canCreate = undefined;
    state.isLoading = true;
    render(
      <>
        <OrganizationListPanel currentOrganizationId="org-a" />
        <CreatePage />
      </>,
    );
    expect(
      screen.queryByRole('button', { name: 'Create organization' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Resolving workspace')).toBeInTheDocument();
    expect(screen.queryByText('Workspace wizard')).not.toBeInTheDocument();
  });

  it('allows retry when the capability lookup fails', async () => {
    state.canCreate = undefined;
    state.isError = true;
    const { user } = render(<CreatePage />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Workspace wizard')).not.toBeInTheDocument();
  });
});
