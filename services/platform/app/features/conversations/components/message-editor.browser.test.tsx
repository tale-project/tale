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
import {
  storedAttachedFile,
  messageDraftKeys,
  type AttachedFile,
  type MessageEditorProps,
} from './message-editor/types';

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useAuth: () => ({ user: { userId: 'user1' } }),
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
  window.localStorage.clear();
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
    await waitFor(() =>
      expect(
        window.localStorage.getItem(messageDraftKeys('user1', undefined).body),
      ).toContain('A named message'),
    );
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
    // Focus eases the box from 5rem to 20rem over 300ms, and on a loaded
    // runner that ease can start late. Measure once the focused height is
    // set and its transition has run out, not after a guessed pause
    // (`getAnimations()` flushes style, so it holds a transition the class
    // has only just started).
    await waitFor(() => expect(box).toHaveClass('h-[20rem]'));
    await Promise.all(
      box.getAnimations().map((animation) => animation.finished),
    );
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

/**
 * The ✕ beside an attached file had no accessible name: a screen reader heard
 * "button" and could not tell which file it removed (WCAG 4.1.2). It is named
 * after the file, and so is every file an undone send hands back.
 */
describe('Inbox reply box file chips (real browser)', () => {
  it('names the remove button after the file, and removes that file', async () => {
    const { user, container } = render(
      <MessageEditor organizationId="org1" placeholder="Write your message…" />,
    );
    await screen.findByRole('textbox', { name: 'Write your message…' });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('the reply box has no file input');
    await user.upload(
      input,
      new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
    );

    const remove = await screen.findByRole('button', {
      name: 'Remove invoice.pdf',
    });
    await user.click(remove);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove invoice.pdf' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('invoice.pdf')).not.toBeInTheDocument();
  });

  it('shows the text and the files an undone send handed back', async () => {
    render(
      <MessageEditor
        organizationId="org1"
        placeholder="Write your message…"
        pendingMessage={{
          id: 'm1',
          content: 'The invoice is attached.',
          attachments: [
            storedAttachedFile({
              storageId: 's3:org1/invoice',
              fileName: 'invoice.pdf',
              contentType: 'application/pdf',
              size: 8,
            }),
          ],
        }}
      />,
    );

    const textbox = await screen.findByRole('textbox', {
      name: 'Write your message…',
    });
    await waitFor(() =>
      expect(textbox).toHaveTextContent('The invoice is attached.'),
    );
    expect(
      screen.getByRole('button', { name: 'Remove invoice.pdf' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
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

// The panel keeps live files per conversation and consumes each undo seed
// once applied; the body keeps using the real persisted draft hook.
it('keeps removed files removed and edited text after leaving an undo draft', async () => {
  const invoice = storedAttachedFile({
    storageId: 's3:org1/invoice',
    fileName: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 8,
  });
  const receipt = storedAttachedFile({
    storageId: 's3:org1/receipt',
    fileName: 'receipt.pdf',
    contentType: 'application/pdf',
    size: 9,
  });
  const onSave = vi.fn().mockResolvedValue(undefined);
  function Conversations() {
    const [id, setId] = useState('c1');
    const [seeds, setSeeds] = useState<
      Record<string, MessageEditorProps['pendingMessage']>
    >({
      c1: { id: 'm1', content: 'Original invoice', attachments: [invoice] },
      c2: { id: 'm2', content: 'Other reply', attachments: [receipt] },
    });
    const [files, setFiles] = useState<Record<string, AttachedFile[]>>({});
    return (
      <>
        <button onClick={() => setId('c1')}>First conversation</button>
        <button onClick={() => setId('c2')}>Second conversation</button>
        <MessageEditor
          key={id}
          organizationId="org1"
          messageId={id}
          placeholder="Write your message…"
          pendingMessage={seeds[id]}
          onSave={onSave}
          attachments={files[id] ?? []}
          onAttachmentsChange={(next) =>
            setFiles((current) => ({
              ...current,
              [id]: typeof next === 'function' ? next(current[id] ?? []) : next,
            }))
          }
          onPendingMessageApplied={() =>
            setSeeds((current) => ({ ...current, [id]: undefined }))
          }
        />
      </>
    );
  }
  const { user } = render(<Conversations />);
  await screen.findByRole('textbox', { name: 'Write your message…' });
  await user.click(
    await screen.findByRole('button', { name: 'Remove invoice.pdf' }),
  );
  await page
    .getByRole('textbox', { name: 'Write your message…' })
    .fill('Edited reply');
  await waitFor(() =>
    expect(
      window.localStorage.getItem(messageDraftKeys('user1', 'c1').body),
    ).toContain('Edited reply'),
  );
  await user.click(screen.getByRole('button', { name: 'Second conversation' }));
  expect(
    await screen.findByRole('button', { name: 'Remove receipt.pdf' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'First conversation' }));
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Write your message…' }),
    ).toHaveTextContent('Edited reply'),
  );
  expect(
    screen.queryByRole('button', { name: 'Remove invoice.pdf' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Remove receipt.pdf' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.stringContaining('Edited reply'),
      [],
      expect.stringContaining('Edited reply'),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Second conversation' }));
  expect(
    await screen.findByRole('button', { name: 'Remove receipt.pdf' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenLastCalledWith(
      expect.stringContaining('Other reply'),
      [receipt],
      expect.stringContaining('Other reply'),
    ),
  );
});
