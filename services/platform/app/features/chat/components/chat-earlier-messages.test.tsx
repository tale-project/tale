// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { useChatEarlierMessages } from './chat-earlier-messages';

/**
 * The transcript opens on its newest page. While older messages remain, a
 * button above the first row reads the page before them; a pending read
 * holds the keyboard's place and refuses a repeat, and a failed one says so
 * once. How the row being read holds still is laid out in a real browser
 * (chat-earlier-messages.browser.test.tsx).
 */

const state = vi.hoisted(() => ({
  hasMore: true,
  loading: false,
  loadEarlier: vi.fn(async () => true),
}));

vi.mock('../data/chat-backend', () => ({
  useEarlierChatMessages: () => ({
    hasMore: state.hasMore,
    loading: state.loading,
    loadEarlier: state.loadEarlier,
  }),
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

/** The transcript's shape: the way back above the list of rows. */
function Transcript() {
  const { historyRef, earlier } = useChatEarlierMessages('org-1', 't-1', 'm1');
  return (
    <div>
      {earlier}
      <ol
        ref={(node) => {
          historyRef.current = node;
        }}
      >
        <li data-message-key="m1">First</li>
        <li data-message-key="m2">Second</li>
      </ol>
    </div>
  );
}

beforeEach(() => {
  state.hasMore = true;
  state.loading = false;
  state.loadEarlier.mockReset();
  state.loadEarlier.mockResolvedValue(true);
  vi.mocked(toast).mockClear();
});

describe('useChatEarlierMessages', () => {
  it('reads the page before the oldest message on request', async () => {
    const { user } = render(<Transcript />);

    await user.click(
      screen.getByRole('button', { name: 'Show earlier messages' }),
    );

    expect(state.loadEarlier).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows nothing once the thread’s first message is in', () => {
    state.hasMore = false;
    render(<Transcript />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('holds its place while a read runs and refuses a repeat', async () => {
    state.loading = true;
    const { user } = render(<Transcript />);
    const button = screen.getByRole('button', {
      name: 'Show earlier messages',
    });

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(state.loadEarlier).not.toHaveBeenCalled();
  });

  it('says once that a read failed', async () => {
    state.loadEarlier.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { user } = render(<Transcript />);

    await user.click(
      screen.getByRole('button', { name: 'Show earlier messages' }),
    );

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't load earlier messages",
        variant: 'destructive',
      }),
    );
    warn.mockRestore();
  });
});
