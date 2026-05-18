// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/test/utils/render';

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

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
}));

// Mutable mocks so per-test we can swap success/error behaviour.
const mockToast = vi.fn();
let mockMutateAsync: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('../hooks/mutations', () => ({
  useSavePrompt: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useCreatePromptCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRenamePromptCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePromptCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  usePrompts: () => ({ prompts: [], isLoading: false }),
  useCategories: () => ({
    data: { personal: [], team: [], global: [] },
    isLoading: false,
  }),
}));

import { SavePromptDialog } from './save-prompt-dialog';

beforeEach(() => {
  mockToast.mockReset();
  mockMutateAsync = vi.fn().mockResolvedValue({ _id: 'prompt-1' });
});

describe('SavePromptDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello, this is a test prompt."
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders with initial content when open', () => {
    render(
      <SavePromptDialog
        open={true}
        onOpenChange={vi.fn()}
        initialContent="Hello, this is a test prompt."
      />,
    );
    expect(screen.getByText('prompts.saveAs.title')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <SavePromptDialog
        open={false}
        onOpenChange={vi.fn()}
        initialContent="Some content"
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  describe('save flow', () => {
    it('enables Save with no field changes (primary chat-message-verbatim flow)', () => {
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Save this message verbatim"
          sourceMessageId="msg-42"
        />,
      );
      // Save button should be enabled despite no edits — this was the
      // primary B2 blocker before the isDirty rework.
      const saveBtn = screen.getByRole('button', { name: 'prompts.form.save' });
      expect(saveBtn).not.toBeDisabled();
    });

    it('forwards content + sourceMessageId to the mutation and closes on success', async () => {
      const onOpenChange = vi.fn();
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={onOpenChange}
          initialContent="Hello world"
          sourceMessageId="msg-42"
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      );
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      const payload = mockMutateAsync.mock.calls[0][0];
      expect(payload.content).toBe('Hello world');
      expect(payload.sourceMessageId).toBe('msg-42');
      expect(payload.scope).toBe('personal');
      // Success toast fires and dialog closes.
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success' }),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('coerces empty-string sourceMessageId to undefined', async () => {
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello world"
          sourceMessageId=""
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      );
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync.mock.calls[0][0].sourceMessageId).toBeUndefined();
    });

    it('maps rate-limit wire-format error to the rateLimited toast', async () => {
      mockMutateAsync = vi
        .fn()
        .mockRejectedValue(
          new Error(
            '[Request ID: abc] Server Error\nUncaught Error: Rate limit exceeded for ai:prompts-save. Try again in 30 seconds.',
          ),
        );
      const onOpenChange = vi.fn();
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={onOpenChange}
          initialContent="Hello world"
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      );
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'prompts.toast.rateLimited',
            variant: 'destructive',
          }),
        ),
      );
      // Dialog stays open on error.
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('maps too_large ConvexError to the tooLarge toast', async () => {
      mockMutateAsync = vi.fn().mockRejectedValue({
        data: { code: 'too_large', field: 'content' },
      });
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello world"
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      );
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'prompts.toast.tooLarge',
            variant: 'destructive',
          }),
        ),
      );
    });
  });
});
