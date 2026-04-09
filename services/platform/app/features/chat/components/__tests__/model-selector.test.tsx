import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ModelSelector } from '../model-selector';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'modelSelector.label': 'Select model',
        'modelSelector.searchPlaceholder': 'Search models...',
        'modelSelector.noResults': 'No models found',
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
        supportedModels: ['model-a', 'model-b'],
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
        models: [
          {
            id: 'model-a',
            displayName: 'Model A',
            description: 'First model',
            tags: [],
          },
          {
            id: 'model-b',
            displayName: 'Model B',
            description: 'Second model',
            tags: [],
          },
        ],
      },
    ],
  }),
}));

vi.mock('../model-tag-icons', () => ({
  ModelTagIcons: () => null,
}));

describe('ModelSelector', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ModelSelector organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});
