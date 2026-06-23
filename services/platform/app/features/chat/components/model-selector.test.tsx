import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ModelSelector } from './model-selector';

type ProviderModel = {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
};

let mockAgentSupportedModels: string[] = ['model-a', 'model-b'];
let mockProviderModels: ProviderModel[] = [
  {
    id: 'model-a',
    displayName: 'Model A',
    description: 'First model',
    tags: ['chat'],
  },
  {
    id: 'model-b',
    displayName: 'Model B',
    description: 'Second model',
    tags: ['chat'],
  },
];

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'modelSelector.label': 'Select model',
        'modelSelector.searchPlaceholder': 'Search models...',
        'modelSelector.noResults': 'No models found',
        'modelSelector.auto': 'Auto',
        'modelSelector.noModelsAvailable': 'No models available',
        'modelSelector.addModel': 'Add model',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedModelOverrides: {},
    setSelectedModelOverride: vi.fn(),
  }),
}));

// The selector reads a project to honor model restrictions. These tests render
// without a project (org-level chat), so stub it to "no project" — also avoids
// pulling in the real Convex/react-query hook (no QueryClient in this harness).
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({ project: null }),
}));

vi.mock('../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: [
      {
        name: 'assistant',
        displayName: 'Chat Agent',
        get supportedModels() {
          return mockAgentSupportedModels;
        },
      },
    ],
  }),
}));

vi.mock('../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({
    agent: { name: 'assistant', displayName: 'Chat Agent' },
    isLoading: false,
  }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useModelCapabilities: () => new Map(),
  useListProviders: () => ({
    providers: [
      {
        get models() {
          return mockProviderModels;
        },
      },
    ],
  }),
}));

vi.mock('../hooks/use-default-model', () => ({
  useDefaultModel: () => ({ data: null }),
}));

vi.mock('./model-info-popover', () => ({
  ModelInfoPopover: () => null,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useAccessibleModels: () => ({ data: undefined }),
}));

// "Add model" is gated on the `agents` write ability (editing the agent's model
// list) — toggled per-test. Provider setup (`integrations`) stays denied so the
// no-models admin link branch isn't pulled into these tests.
let mockCanWriteAgents = false;
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (_action: string, subject: string) =>
      subject === 'agents' ? mockCanWriteAgents : false,
    cannot: (_action: string, subject: string) =>
      subject === 'agents' ? !mockCanWriteAgents : true,
  }),
  useAbilityLoading: () => false,
}));

// The "Add model" footer navigates to the agent's Instructions & models page;
// stub the router so the component can call `useNavigate` without a provider.
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  // The no-models admin branch renders a TanStack `Link`; stub it as a plain
  // anchor (router-only props dropped) so tests don't need a RouterProvider.
  Link: ({ children }: { children: ReactNode }) => (
    // oxlint-disable-next-line jsx-a11y/anchor-is-valid
    <a href="#">{children}</a>
  ),
}));

describe('ModelSelector', () => {
  beforeEach(() => {
    mockCanWriteAgents = false;
    mockNavigate.mockClear();
    mockAgentSupportedModels = ['model-a', 'model-b'];
    mockProviderModels = [
      {
        id: 'model-a',
        displayName: 'Model A',
        description: 'First model',
        tags: ['chat'],
      },
      {
        id: 'model-b',
        displayName: 'Model B',
        description: 'Second model',
        tags: ['chat'],
      },
    ];
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ModelSelector organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });

  describe('rendering branches', () => {
    it('shows the single model name when only one model is available', () => {
      mockAgentSupportedModels = ['model-a'];
      mockProviderModels = [
        {
          id: 'model-a',
          displayName: 'Model A',
          description: 'First model',
          tags: ['chat'],
        },
      ];

      render(<ModelSelector organizationId="org-1" />);

      expect(screen.getByText('Model A')).toBeInTheDocument();
      expect(screen.queryByText('Auto')).not.toBeInTheDocument();
    });

    it('shows the no-models-available warning when no models match', () => {
      mockAgentSupportedModels = ['model-a'];
      mockProviderModels = [
        {
          id: 'model-a',
          displayName: 'Model A',
          description: 'First model',
          tags: [],
        },
      ];

      render(<ModelSelector organizationId="org-1" />);

      expect(screen.getByText('No models available')).toBeInTheDocument();
      expect(screen.queryByText('Auto')).not.toBeInTheDocument();
    });
  });

  describe('"Add model" footer', () => {
    it('shows "Add model" when the user can manage agents', async () => {
      mockCanWriteAgents = true;

      const { user } = render(<ModelSelector organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Select model' }));

      expect(screen.getByText('Add model')).toBeInTheDocument();
    });

    it('hides "Add model" when the user cannot manage agents', async () => {
      mockCanWriteAgents = false;

      const { user } = render(<ModelSelector organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Select model' }));

      expect(screen.queryByText('Add model')).not.toBeInTheDocument();
    });

    it("navigates to the agent's models section when clicked", async () => {
      mockCanWriteAgents = true;

      const { user } = render(<ModelSelector organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Select model' }));
      await user.click(screen.getByText('Add model'));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard/$id/agents/$agentId/instructions',
        params: { id: 'org-1', agentId: 'assistant' },
        hash: 'models',
      });
    });
  });

  // The dropdown footer only exists when there are 2+ models to pick between.
  // These cover the states that render no dropdown but where an editor can still
  // grow the agent's model list (single model, or models exist but none reach
  // the agent) — and the cold-start case where adding to the agent wouldn't help.
  describe('inline "Add model" affordance (non-dropdown states)', () => {
    const singleModel = () => {
      mockAgentSupportedModels = ['model-a'];
      mockProviderModels = [
        {
          id: 'model-a',
          displayName: 'Model A',
          description: 'First model',
          tags: ['chat'],
        },
      ];
    };

    it('shows it beside a single model when the user can manage agents', () => {
      mockCanWriteAgents = true;
      singleModel();

      render(<ModelSelector organizationId="org-1" />);

      expect(screen.getByText('Model A')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add model' }),
      ).toBeInTheDocument();
    });

    it('hides it beside a single model without agents-write', () => {
      mockCanWriteAgents = false;
      singleModel();

      render(<ModelSelector organizationId="org-1" />);

      expect(screen.getByText('Model A')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add model' }),
      ).not.toBeInTheDocument();
    });

    it('navigates to the agent models section when clicked', async () => {
      mockCanWriteAgents = true;
      singleModel();

      const { user } = render(<ModelSelector organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Add model' }));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard/$id/agents/$agentId/instructions',
        params: { id: 'org-1', agentId: 'assistant' },
        hash: 'models',
      });
    });

    it('shows it in the no-models state when models exist but none reach the agent', () => {
      mockCanWriteAgents = true;
      // Provider has a model (so it's not cold-start), but its tags don't match
      // the agent's required `chat` tag → none reach the agent.
      mockAgentSupportedModels = ['model-a'];
      mockProviderModels = [
        {
          id: 'model-a',
          displayName: 'Model A',
          description: 'First model',
          tags: [],
        },
      ];

      render(<ModelSelector organizationId="org-1" />);

      expect(screen.getByText('No models available')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add model' }),
      ).toBeInTheDocument();
    });

    it('does not show it on cold start (no provider configured)', () => {
      mockCanWriteAgents = true;
      // No provider models at all → adding to the agent can't help; provider
      // setup is the real first step, so no "Add model" jump here.
      mockAgentSupportedModels = ['model-a'];
      mockProviderModels = [];

      render(<ModelSelector organizationId="org-1" />);

      expect(screen.getByText('No models available')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add model' }),
      ).not.toBeInTheDocument();
    });
  });
});
