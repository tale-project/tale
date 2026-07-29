import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ModelAccessEditor } from './model-access-editor';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
// A fresh object per render is fine: the editor seeds local state once via an
// init ref, so it never loops on a changing reference.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: {
      enabled: true,
      mode: 'blocklist' as const,
      rules: [] as unknown[],
    } as Record<string, unknown> | null,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

const STABLE_MEMBERS = { members: [] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

const STABLE_PROVIDERS = {
  providers: [
    {
      name: 'openai',
      displayName: 'OpenAI',
      models: [{ id: 'openai/gpt-4o', displayName: 'GPT-4o', tags: ['chat'] }],
    },
  ],
};
vi.mock('../hooks/model-catalog', () => ({
  useListProviders: () => STABLE_PROVIDERS,
  useModelCapabilities: () => new Map(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

function setLoaded() {
  state.isLoading = false;
  state.config = {
    enabled: true,
    mode: 'blocklist',
    rules: [
      { scope: 'default', allowedModels: [], blockedModels: ['openai/gpt-4o'] },
    ],
  };
}
function setLoading() {
  state.isLoading = true;
  state.config = null;
}

describe('ModelAccessEditor', () => {
  describe('loaded state', () => {
    it('renders the real enable switch (in the a11y tree)', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /model access/i }),
      ).toBeInTheDocument();
    });

    it('renders the saved rule rows (real data, no placeholders)', () => {
      setLoaded();
      const { container } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: /edit rule/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch/buttons while loading)', () => {
      setLoading();
      render(<ModelAccessEditor organizationId="org-1" />);
      // The masked Switch renders a SkeletonBox (no role=switch) and masked
      // Buttons are aria-hidden → all excluded from the a11y tree.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('renders placeholder rows so the table reads as loading, not empty', () => {
      setLoading();
      const { container } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      // The body is forced visible while loading even though `enabled` has not
      // been seeded yet; three placeholder rows render, NOT the empty-state.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(
        screen.queryByText(/no access rules configured/i),
      ).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /model access/i }),
      ).toBeInTheDocument();
    });
  });
});
