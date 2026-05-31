import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { DefaultModelEditor } from './default-model-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, rules: [] } as {
      enabled: boolean;
      rules: unknown[];
    } | null,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [{ id: 'team-1', name: 'Engineering' }],
    isLoading: false,
  }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useListProviders: () => ({
    providers: [
      {
        name: 'openai',
        displayName: 'OpenAI',
        models: [
          { id: 'openai/gpt-4o', displayName: 'GPT-4o', tags: ['chat'] },
        ],
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function setLoaded() {
  state.isLoading = false;
  state.config = {
    enabled: true,
    rules: [
      { scope: 'default', providerName: 'openai', modelId: 'openai/gpt-4o' },
    ],
  };
}
function setLoading() {
  state.isLoading = true;
  state.config = null;
}

describe('DefaultModelEditor', () => {
  describe('loaded state', () => {
    it('renders the real action button (in the a11y tree)', () => {
      setLoaded();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(
        screen.getByRole('button', { name: /add rule/i }),
      ).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /default models/i }),
      ).toBeInTheDocument();
    });

    it('renders the saved rule rows (real data, no placeholders)', () => {
      setLoaded();
      const { container } = render(
        <DefaultModelEditor organizationId="org-1" />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: /edit rule 1/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the interactive controls (no live buttons while loading)', () => {
      setLoading();
      render(<DefaultModelEditor organizationId="org-1" />);
      // The masked action button is aria-hidden → excluded from the a11y tree.
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('renders placeholder rows so the table reads as loading, not empty', () => {
      setLoading();
      const { container } = render(
        <DefaultModelEditor organizationId="org-1" />,
      );
      // Three placeholder rows, NOT the empty-state row.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(
        screen.queryByText(/no rules configured/i),
      ).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /default models/i }),
      ).toBeInTheDocument();
    });
  });
});
