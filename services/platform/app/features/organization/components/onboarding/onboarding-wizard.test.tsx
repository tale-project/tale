import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));
// The account menu reads its own data; here it only has to stand aside.
vi.mock('@/app/components/user-button', () => ({ UserButton: () => null }));
// The workspace step has its own suite; here it only makes the workspace.
vi.mock('./steps/workspace-step', async () => {
  const { WizardStep } = await import('@tale/ui/wizard/wizard');
  return {
    WorkspaceStep: ({ onCreated }: { onCreated: (id: string) => void }) => (
      <WizardStep id="workspace">
        <button type="button" onClick={() => onCreated('org-1')}>
          Make the workspace
        </button>
      </WizardStep>
    ),
  };
});
// No coding agent may connect here, so the last step shows its other rows.
vi.mock('@/app/features/settings/agent-connections/hooks/queries', () => ({
  useAgentConnectionAccess: () => ({ data: undefined }),
  useAgentConnections: () => ({
    data: { connections: [], canSeeEveryone: false },
  }),
}));

import { OnboardingWizard } from './onboarding-wizard';

let backend: SyntheticBackend;

beforeEach(() => {
  h.navigate.mockReset();
  backend = syntheticBackend();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The add-org wizard, past its workspace step and on its last step. */
async function reachFinish() {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingWizard mode="add-org" />
    </QueryClientProvider>,
  );
  await view.user.click(
    screen.getByRole('button', { name: 'Make the workspace' }),
  );
  await view.user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: 'Invite teammates' });
  return view;
}

/**
 * Leaving the wizard from its last step lands the person in the workspace it
 * made, and stores nothing on the way: nothing reads a mark that onboarding
 * was finished, so the wizard writes none (#5213).
 */
describe('OnboardingWizard leaving from its last step', () => {
  it('lands on the new workspace', async () => {
    const { user } = await reachFinish();

    await user.click(screen.getByRole('button', { name: 'Go to Home' }));

    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: '/dashboard/$id',
        params: { id: 'org-1' },
      }),
    );
    expect(backend.calls).toEqual([]);
  });

  it('sends each next step to the page where it is done', async () => {
    const { user } = await reachFinish();

    await user.click(
      screen.getByRole('button', { name: 'Connect a provider' }),
    );
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: '/dashboard/$id/settings/providers',
        params: { id: 'org-1' },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Invite teammates' }));
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: '/dashboard/$id/settings/organization',
        params: { id: 'org-1' },
      }),
    );
    expect(backend.calls).toEqual([]);
  });
});
