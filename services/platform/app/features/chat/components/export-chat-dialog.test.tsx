import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ExportChatDialog } from './export-chat-dialog';

// Migrated from the `chat-features` E2E "export dialog renders its options and
// the Markdown export downloads": the dialog is a client-only component (no
// backend mutation — the message list comes from a single query and the
// Markdown export is a pure client-side Blob download), so it belongs at the
// component tier. We mock the thread-messages query and assert the same seam
// the E2E did: both format buttons + the picker control render, and the
// Markdown button writes a `chat-export.md` download.
const mockMessages = [
  { _id: 'm1', role: 'user' as const, content: 'Hello there' },
  { _id: 'm2', role: 'assistant' as const, content: 'General Kenobi' },
];

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: { messages: mockMessages },
    isLoading: false,
  }),
}));

describe('ExportChatDialog', () => {
  let createObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    // jsdom implements neither; the export path calls both.
    createObjectURL = vi.fn(() => 'blob:mock');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when closed', () => {
    const { container } = render(
      <ExportChatDialog
        open={false}
        onOpenChange={vi.fn()}
        threadId="thread-1"
        organizationId="org-1"
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders both export options and the message picker when open', async () => {
    const { container } = render(
      <ExportChatDialog
        open={true}
        onOpenChange={vi.fn()}
        threadId="thread-1"
        organizationId="org-1"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Download Markdown' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download PDF' }),
    ).toBeInTheDocument();
    // All messages start selected, so the toggle reads "Deselect all".
    expect(
      screen.getByRole('button', { name: 'Deselect all' }),
    ).toBeInTheDocument();

    await checkAccessibility(container);
  });

  it('downloads a chat-export.md file when Download Markdown is clicked', async () => {
    let downloadedName: string | undefined;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedName = this.download;
      });

    const { user } = render(
      <ExportChatDialog
        open={true}
        onOpenChange={vi.fn()}
        threadId="thread-1"
        organizationId="org-1"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Download Markdown' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(downloadedName).toBe('chat-export.md');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
