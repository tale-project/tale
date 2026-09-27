import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

import { useSendMessageViaConnector } from '../hooks/mutations';
import { MessageEditor } from './message-editor';

const persisted = vi.hoisted(() => ({ body: '' }));

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useAuth: () => ({ user: { userId: 'user1' } }),
}));
vi.mock('@/app/hooks/use-persisted-state', () => ({
  usePersistedState: (_key: string, initial: string) => {
    const [value, setValue] = useState(initial);
    return [
      value,
      (next: string) => {
        persisted.body = next;
        setValue(next);
      },
      () => setValue(initial),
    ];
  },
}));
vi.mock('../hooks/actions', () => ({
  useImproveMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./message-editor/improve-mode', () => ({ ImproveMode: () => null }));
vi.mock('./message-improvement-dialog', () => ({
  MessageImprovementDialog: () => null,
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Inbox real rich-text editor', () => {
  it('names its actual editable textbox and exposes multiline semantics', async () => {
    const { user } = render(
      <MessageEditor organizationId="org1" placeholder="Write your message…" />,
    );
    const textbox = await screen.findByRole('textbox', {
      name: 'Write your message…',
    });
    expect(textbox).toHaveAttribute('contenteditable', 'true');
    expect(textbox).toHaveAttribute('aria-multiline', 'true');
    await user.click(textbox);
    await user.keyboard('A named message');
    expect(textbox).toHaveTextContent('A named message');
    await waitFor(() => expect(persisted.body).toContain('A named message'));
  });
});

// A focused reply box grows to 20rem. On a short viewport — a phone held
// sideways, a laptop at 200 % — that was taller than the whole reading pane:
// it pushed its own Send off the screen. There it keeps to 30 % of the
// height and scrolls inside.
describe('Inbox editor height (real layout)', () => {
  async function focusedHeight() {
    const { user } = render(
      <MessageEditor organizationId="org1" placeholder="Write your message…" />,
    );
    await user.click(
      await screen.findByRole('textbox', { name: 'Write your message…' }),
    );
    const box = screen
      .getByRole('textbox', { name: 'Write your message…' })
      // oxlint-disable-next-line testing-library/no-node-access -- the sized box is structural, not a queryable role
      .closest('.overflow-y-auto');
    if (!(box instanceof HTMLElement)) throw new Error('no editor box');
    // the height eases in over 300ms
    await new Promise((resolve) => setTimeout(resolve, 400));
    return box.getBoundingClientRect().height;
  }

  it('grows to its full 20rem on a tall viewport', async () => {
    await page.viewport(1280, 800);
    expect(await focusedHeight()).toBeCloseTo(320, 0);
  });

  it('keeps to 30 % of a short viewport', async () => {
    await page.viewport(640, 360);
    expect(await focusedHeight()).toBeLessThanOrEqual(0.3 * 360 + 0.5);
  });
});

/** The reply box's caller in miniature: the files as the Inbox's upload
 * step names them, sent through the reply mutation the panel uses. */
function ReplyBox() {
  const { mutateAsync: sendMessageViaConnector } = useSendMessageViaConnector();
  return (
    <MessageEditor
      organizationId="org1"
      placeholder="Write your message…"
      onSave={async (message, attachments = [], sourceMarkdown) => {
        await sendMessageViaConnector({
          conversationId: 'c1',
          organizationId: 'org1',
          content: message,
          ...(sourceMarkdown ? { sourceMarkdown } : {}),
          ...(attachments.length > 0
            ? {
                attachments: attachments.map(({ file }) => ({
                  storageId: `blob-${file?.name ?? ''}`,
                  fileName: file?.name ?? '',
                  contentType: file?.type ?? '',
                  size: file?.size ?? 0,
                })),
              }
            : {}),
        });
      }}
    />
  );
}

/**
 * A file attached, nothing typed: the reply box offers Send, and pressing it
 * must post the reply. The send used to refuse the empty body the editor
 * handed over, so the person read "Couldn't send message" instead.
 */
describe('Inbox reply that carries only a file', () => {
  it('posts the file with an empty body, and reports no failure', async () => {
    vi.mocked(toast).mockClear();
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messageId: 'm1' })));
    const { user, container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReplyBox />
      </QueryClientProvider>,
    );
    await screen.findByRole('textbox', { name: 'Write your message…' });
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('the reply box has no file input');
    await user.upload(
      input,
      new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/app/conversations/c1/reply'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    const sent: unknown = typeof body === 'string' ? JSON.parse(body) : body;
    expect(sent).toEqual({
      content: '',
      attachments: [
        {
          storageId: 'blob-invoice.pdf',
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 8,
        },
      ],
    });
    expect(toast).not.toHaveBeenCalled();
  });
});
