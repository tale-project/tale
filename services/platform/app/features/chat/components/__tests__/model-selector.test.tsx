import { describe, it, expect, beforeEach, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { ModelSelector } from '../model-selector';

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
        'modelSelector.autoDescription': 'Auto description',
        'modelSelector.noModelsAvailable': 'No models available',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('../../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedModelOverrides: {},
    setSelectedModelOverride: vi.fn(),
  }),
}));

vi.mock('../../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: [
      {
        name: 'chat-agent',
        displayName: 'Chat Agent',
        get supportedModels() {
          return mockAgentSupportedModels;
        },
      },
    ],
  }),
}));

vi.mock('../../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({
    agent: { name: 'chat-agent', displayName: 'Chat Agent' },
    isLoading: false,
  }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
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

vi.mock('../../hooks/use-default-model', () => ({
  useDefaultModel: () => ({ data: null }),
}));

vi.mock('../model-tag-icons', () => ({
  ModelTagIcons: () => null,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useAccessibleModels: () => ({ data: undefined }),
}));

describe('ModelSelector', () => {
  beforeEach(() => {
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
});
