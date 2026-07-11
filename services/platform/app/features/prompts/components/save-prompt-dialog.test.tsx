// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

// Spied stub — mirrors the previous inline stub's rendered text exactly, but
// records call args too, so tests can assert on the exact `params` a
// translation call was made with (the stub never resolves a real message
// catalog, so it can't substitute a param into a translation VALUE).
const mockT = vi.fn(
  (ns: string, key: string, params?: Record<string, string | number>) => {
    const base = `${ns}.${key}`;
    if (!params) return base;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      base,
    );
  },
);

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string | number>) =>
      mockT(ns, key, params),
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
  mockT.mockClear();
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

  // Regression for #2644: the dialog used to save with no Title field at
  // all, so the AI-generated title was invisible and unfixable pre-save.
  describe('title field (#2644)', () => {
    it('exposes an editable Title field and forwards a typed title to the mutation', async () => {
      const { user } = render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello world"
        />,
      );
      const titleInput = screen.getByLabelText('prompts.form.titleLabel');
      await user.type(titleInput, 'My saved title');
      await user.click(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      );
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync.mock.calls[0][0].title).toBe('My saved title');
    });

    it('forwards undefined when the title is left blank, so the server AI-generates one on demand', async () => {
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
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync.mock.calls[0][0].title).toBeUndefined();
    });
  });

  // Regression for #2644: selecting "Team" scope in a teamless org used to
  // silently disable Save with no picker and no explanation.
  describe('team scope in a teamless org (#2644)', () => {
    it('explains the missing team instead of leaving Save silently disabled', () => {
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello world"
        />,
      );
      fireEvent.click(
        screen.getByRole('radio', { name: 'prompts.scope.team' }),
      );
      expect(
        screen.getByText('prompts.form.noTeamsAvailable'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      ).toBeDisabled();
    });
  });

  // Regression for #2644: the size indicator used to read raw bytes/KB
  // ("45 B / 16.0 KB") — a developer unit — instead of characters.
  describe('size indicator (#2644)', () => {
    it('uses the character-count key, not the byte-count one', () => {
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent="Hello world"
        />,
      );
      expect(screen.getByText('prompts.form.charsUsed')).toBeInTheDocument();
      expect(
        screen.queryByText('prompts.form.bytesUsed'),
      ).not.toBeInTheDocument();
    });

    // Regression: the #2644 fix compared `content.length` (characters)
    // straight against `MAX_PROMPT_CONTENT_BYTES` (a UTF-8 byte cap), so
    // multi-byte content read as "under limit" in the counter while Save
    // was already byte-blocked — a contradiction. The counter must never
    // pair a char count with that byte-cap number again.
    it('never claims under-limit in the counter while Save is byte-blocked by multi-byte content', () => {
      // 9,000 'é' chars = 9,000 JS string units but 18,000 UTF-8 bytes —
      // comfortably under the 16,384 byte cap in *characters*, over it in
      // *bytes*.
      const content = 'é'.repeat(9_000);
      render(
        <SavePromptDialog
          open={true}
          onOpenChange={vi.fn()}
          initialContent={content}
        />,
      );

      // The real, byte-based gate has tripped.
      expect(
        screen.getByRole('button', { name: 'prompts.form.save' }),
      ).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'prompts.form.bytesOverLimitAlert',
      );

      // The counter reports only the character count — no byte-cap number
      // riding along that would misleadingly suggest headroom. Take the
      // LAST call: earlier renders can reflect intermediate state.
      const charsUsedCalls = mockT.mock.calls.filter(
        ([, key]) => key === 'form.charsUsed',
      );
      expect(charsUsedCalls.at(-1)?.[2]).toEqual({ used: 9_000 });

      // The real cap is instead surfaced, human-readable, in the alert that
      // only appears once it's actually relevant.
      const alertCalls = mockT.mock.calls.filter(
        ([, key]) => key === 'form.bytesOverLimitAlert',
      );
      expect(alertCalls.at(-1)?.[2]).toEqual({ limit: '16 KB' });
    });
  });
});
