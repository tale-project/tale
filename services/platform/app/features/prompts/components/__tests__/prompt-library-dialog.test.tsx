// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-1' } }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { role: 'admin' } }),
}));

vi.mock('../../hooks/queries', () => ({
  usePrompts: () => ({
    prompts: [
      {
        _id: 'prompt-1',
        _creationTime: 1700000000000,
        organizationId: 'test-org-id',
        createdBy: 'user-1',
        title: 'Test Prompt',
        content: 'Hello {{name}}, how can I help?',
        description: 'A test prompt',
        scope: 'personal',
        category: 'testing',
        tags: ['test'],
        usageCount: 5,
        isPublished: true,
      },
    ],
    isLoading: false,
  }),
  usePrompt: () => ({ data: null, isLoading: false }),
  usePromptHistory: () => ({ data: null, isLoading: false }),
}));

vi.mock('../../hooks/mutations', () => ({
  useCreatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIncrementPromptUsage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestorePromptFromVersion: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

import { PromptLibraryDialog } from '../prompt-library-dialog';

describe('PromptLibraryDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <PromptLibraryDialog
          open={true}
          onOpenChange={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders prompt cards when open', () => {
    render(
      <PromptLibraryDialog
        open={true}
        onOpenChange={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Prompt')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <PromptLibraryDialog
        open={false}
        onOpenChange={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
