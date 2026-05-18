// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { fireEvent, render, screen } from '@/test/utils/render';

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

// Mutable per-test result for usePrompt so OCC-banner tests can override.
let mockUsePromptResult: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock('../hooks/queries', () => ({
  usePrompts: () => ({ prompts: [], isLoading: false }),
  usePrompt: () => mockUsePromptResult,
}));

import { PromptFormDialog } from './prompt-form-dialog';

beforeEach(() => {
  mockUsePromptResult = { data: undefined, isLoading: false };
});

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

  describe('edit-mode OCC', () => {
    const baseEditPrompt = {
      _id: 'prompt-1' as never,
      _creationTime: 1700000000000,
      organizationId: 'test-org-id',
      createdBy: 'user-1',
      title: 'Existing',
      content: 'Original body',
      scope: 'personal' as const,
      usageCount: 0,
      version: 3,
    };

    it('threads expectedVersion into onSubmit from initialData.version', () => {
      const onSubmit = vi.fn();
      render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          isSubmitting={false}
          initialData={baseEditPrompt}
        />,
      );
      // Edit the title so isDirty becomes true and submit is enabled.
      const titleInput = screen.getByDisplayValue('Existing');
      fireEvent.change(titleInput, { target: { value: 'Edited Title' } });
      const saveBtn = screen.getByRole('button', { name: 'prompts.form.save' });
      fireEvent.click(saveBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const payload = onSubmit.mock.calls[0][0];
      expect(payload.expectedVersion).toBe(3);
      expect(payload.title).toBe('Edited Title');
    });

    it('renders OCC banner when live.version > anchored version', () => {
      mockUsePromptResult = {
        data: { ...baseEditPrompt, version: 4 },
        isLoading: false,
      };
      render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
          initialData={baseEditPrompt}
        />,
      );
      expect(
        screen.getByText('prompts.form.versionConflictTitle'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'prompts.form.loadLatest' }),
      ).toBeInTheDocument();
    });

    it('Load latest repopulates fields from live data', () => {
      mockUsePromptResult = {
        data: {
          ...baseEditPrompt,
          version: 4,
          title: 'Server Title',
          content: 'Server body',
        },
        isLoading: false,
      };
      render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
          initialData={baseEditPrompt}
        />,
      );
      const loadLatest = screen.getByRole('button', {
        name: 'prompts.form.loadLatest',
      });
      fireEvent.click(loadLatest);
      expect(screen.getByDisplayValue('Server Title')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Server body')).toBeInTheDocument();
    });

    it('Load latest with dirty draft prompts to confirm discard', () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      mockUsePromptResult = {
        data: { ...baseEditPrompt, version: 4, title: 'Server Title' },
        isLoading: false,
      };
      render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
          initialData={baseEditPrompt}
        />,
      );
      // Dirty the draft so the confirm gate fires.
      const titleInput = screen.getByDisplayValue('Existing');
      fireEvent.change(titleInput, { target: { value: 'My Draft' } });

      fireEvent.click(
        screen.getByRole('button', { name: 'prompts.form.loadLatest' }),
      );
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      // Cancel => draft preserved, server title NOT loaded.
      expect(screen.getByDisplayValue('My Draft')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Server Title')).toBeNull();
      confirmSpy.mockRestore();
    });
  });

  describe('admin-only global tab', () => {
    it('hides the global tab when isOrgAdmin=false and scope is not global', () => {
      render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
          isOrgAdmin={false}
        />,
      );
      expect(
        screen.queryByRole('tab', { name: 'prompts.scope.global' }),
      ).toBeNull();
    });

    it('still renders the global tab for a non-admin editing an already-global prompt', () => {
      const globalPrompt = {
        _id: 'prompt-global' as never,
        _creationTime: 1700000000000,
        organizationId: 'test-org-id',
        createdBy: 'user-1',
        title: 'Existing global',
        content: 'body',
        scope: 'global' as const,
        usageCount: 0,
        version: 1,
      };
      mockUsePromptResult = { data: globalPrompt, isLoading: false };
      render(
        <PromptFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          isSubmitting={false}
          isOrgAdmin={false}
          initialData={globalPrompt}
        />,
      );
      expect(
        screen.getByRole('tab', { name: 'prompts.scope.global' }),
      ).toBeInTheDocument();
    });
  });
});

afterEach(() => {
  mockUsePromptResult = { data: undefined, isLoading: false };
});
