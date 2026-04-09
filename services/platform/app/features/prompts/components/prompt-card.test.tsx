import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { PromptTemplate } from '../hooks/queries';
import { PromptCard } from './prompt-card';

function makePrompt(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    _id: 'prompt-1' as PromptTemplate['_id'],
    _creationTime: Date.now(),
    organizationId: 'org-1',
    createdBy: 'user-1',
    title: 'Test Prompt',
    content: 'You are a helpful assistant that {{task}}.',
    description: 'A test prompt template',
    scope: 'personal',
    category: 'general',
    tags: ['test'],
    usageCount: 3,
    isPublished: true,
    ...overrides,
  };
}

describe('PromptCard', () => {
  describe('accessibility', () => {
    it('passes axe audit with full props', async () => {
      const { container } = render(
        <PromptCard
          prompt={makePrompt()}
          onUse={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          canModify={true}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without modify actions', async () => {
      const { container } = render(
        <PromptCard
          prompt={makePrompt({ usageCount: 0, description: undefined })}
          onUse={vi.fn()}
          canModify={false}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with team scope', async () => {
      const { container } = render(
        <PromptCard
          prompt={makePrompt({ scope: 'team', category: undefined })}
          onUse={vi.fn()}
          canModify={false}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
