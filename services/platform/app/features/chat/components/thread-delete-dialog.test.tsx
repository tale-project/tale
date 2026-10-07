// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { ThreadDeleteDialog } from './thread-delete-dialog';

// Where a delete lands: the conversation on screen is left for a fresh chat,
// never for plain `/chat` — that resumes the most recent chat, and the list
// still names the deleted one until it has read again, so the reader came
// straight back to "This chat is not available".

const { mockNavigate, mockTrash, mockToast, routeParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockTrash: vi.fn<(threadId: string) => Promise<boolean>>(),
  mockToast: vi.fn(),
  routeParams: { current: {} as Record<string, string> },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useParams: () => routeParams.current,
}));

vi.mock('../data/thread-actions', () => ({
  useThreadActions: () => ({ trash: mockTrash }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

function renderDialog() {
  const onOpenChange = vi.fn();
  const view = render(
    <ThreadDeleteDialog
      thread={{ id: 't1', title: 'Quarterly report' }}
      organizationId="org-1"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { ...view, onOpenChange };
}

describe('ThreadDeleteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams.current = { id: 'org-1' };
  });

  it('leaves the deleted conversation for a fresh chat', async () => {
    routeParams.current = { id: 'org-1', threadId: 't1' };
    mockTrash.mockResolvedValueOnce(true);
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledExactlyOnceWith({
        to: '/dashboard/$id/chat',
        params: { id: 'org-1' },
        search: { new: true },
        replace: true,
      }),
    );
    expect(mockTrash).toHaveBeenCalledWith('t1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays on another conversation when a row deletes this chat', async () => {
    routeParams.current = { id: 'org-1', threadId: 't2' };
    mockTrash.mockResolvedValueOnce(true);
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('stays where it is off the chat pages', async () => {
    mockTrash.mockResolvedValueOnce(true);
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the conversation and the dialog when the delete is refused', async () => {
    routeParams.current = { id: 'org-1', threadId: 't1' };
    mockTrash.mockResolvedValueOnce(false);
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't delete chat",
        variant: 'destructive',
      }),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
