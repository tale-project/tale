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

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
}));

vi.mock('../../hooks/queries', async () => {
  const actual = await vi.importActual<
    typeof import('../../hooks/queries')
  >('../../hooks/queries');
  return {
    ...actual,
    usePrompts: () => ({ prompts: [], isLoading: false }),
  };
});

import { PromptFormDialog } from '../prompt-form-dialog';

describe('PromptFormDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit in create mode', async () => {
      const { container } = render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in edit mode', async () => {
      const { container } = render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
          initialData={{
            _id: 'prompt-1' as never,
            _creationTime: 1700000000000,
            organizationId: 'test-org-id',
            createdBy: 'user-1',
            title: 'Existing Prompt',
            content: 'Some content',
            description: 'A description',
            scope: 'personal',
            category: 'general',
            tags: ['tag1'],
            usageCount: 3,
            isPublished: true,
          }}
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('shows create title when no initial data', () => {
    render(
      <PromptFormDialog
        open={true}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    );
    expect(screen.getByText('prompts.form.createTitle')).toBeInTheDocument();
  });

  it('shows edit title with initial data', () => {
    render(
      <PromptFormDialog
        open={true}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        initialData={{
          _id: 'prompt-1' as never,
          _creationTime: 1700000000000,
          organizationId: 'test-org-id',
          createdBy: 'user-1',
          title: 'Existing Prompt',
          content: 'Some content',
          scope: 'personal',
          usageCount: 0,
          isPublished: true,
        }}
      />,
    );
    expect(screen.getByText('prompts.form.editTitle')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <PromptFormDialog
        open={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
