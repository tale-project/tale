import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import type { Conversation } from '../types';
import { ConversationPanel } from './conversation-panel';
import {
  attachedFileName,
  type MessageEditorProps,
} from './message-editor/types';

/**
 * Undoing a queued reply hands its draft back to the composer: the text AND
 * the files. The panel used to seed the text alone, and only when there was
 * some — so undoing a reply that carried only an attachment restored nothing.
 */

const INVOICE = {
  storageId: 's3:org1/invoice',
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 8,
};

let conversation: Conversation;
let undone: {
  sourceMarkdown: string | null;
  attachments?: (typeof INVOICE)[];
};
let editor: MessageEditorProps | undefined;

const undoSendMessage = vi.fn(
  (
    _args: { messageId: string },
    options: { onSuccess: (result: typeof undone) => void },
  ) => options.onSuccess(undone),
);
const sendMessageViaConnector = vi.fn(async () => 'm2');
const discardSuggestedReply = vi.fn();
const markAsRead = vi.fn();
const generateUploadUrl = vi.fn(async () => 'https://upload.test/put');

vi.mock('../hooks/queries', () => ({
  useConversationWithMessages: () => ({
    data: conversation,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMailboxes: () => ({ mailboxes: [] }),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardOutboundMessage: () => ({ mutate: vi.fn() }),
  useDiscardSuggestedReply: () => ({
    mutate: discardSuggestedReply,
    isPending: false,
  }),
  useGenerateUploadUrl: () => ({ mutateAsync: generateUploadUrl }),
  useMarkAsRead: () => ({ mutate: markAsRead }),
  useReopenConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useRetrySendMessage: () => ({ mutate: vi.fn() }),
  useSendMessageViaConnector: () => ({ mutateAsync: sendMessageViaConnector }),
  useUndoSendMessage: () => ({ mutate: undoSendMessage }),
}));

vi.mock('@/app/features/home/components/home-panel-toggle', () => ({
  HomePanelToggle: () => null,
}));
vi.mock('./inbox-mobile-back-button', () => ({
  InboxMobileBackButton: () => null,
}));
vi.mock('./conversation-header', () => ({
  ConversationHeader: () => null,
  ConversationHeaderSkeleton: () => null,
}));

// The composer stands in as what it is seeded with; `message-editor.test.tsx`
// owns what the editor does with a seed.
vi.mock('./message-editor', () => ({
  MessageEditor: (props: MessageEditorProps) => {
    editor = props;
    return (
      <section aria-label="Composer">
        <p>{props.pendingMessage?.content}</p>
        <ul>
          {props.pendingMessage?.attachments?.map((file) => (
            <li key={file.id}>{attachedFileName(file)}</li>
          ))}
        </ul>
      </section>
    );
  },
}));

function conversationFixture(id: string): Conversation {
  const now = new Date().toISOString();
  return {
    _id: id,
    id,
    organizationId: 'org1',
    _creationTime: 1,
    title: 'Order 42',
    description: '',
    status: 'open',
    channel: 'email',
    contact: {
      id: 'contact1',
      email: 'carla@ext.test',
      created_at: now,
    },
    created_at: now,
    contact_id: 'contact1',
    business_id: 'org1',
    message_count: 1,
    unread_count: 0,
    updated_at: now,
    last_message_at: now,
    last_read_at: now,
    messages: [
      {
        id: `${id}-queued`,
        content: '<p>The invoice is attached.</p>',
        timestamp: now,
        sender: 'connector',
        isCustomer: false,
        status: 'queued',
        scheduledSendAt: Date.now() + 60_000,
      },
    ],
  };
}

async function renderAndUndo() {
  const view = render(
    <ConversationPanel
      selectedConversationId="c1"
      onSelectedConversationChange={vi.fn()}
    />,
  );
  await view.user.click(screen.getByRole('button', { name: 'Undo' }));
  const composer = await screen.findByRole('region', { name: 'Composer' });
  return { ...view, composer };
}

describe('ConversationPanel — undoing a reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversation = conversationFixture('c1');
    editor = undefined;
  });

  it('hands the text and the files back to the composer', async () => {
    undone = {
      sourceMarkdown: 'The invoice is attached.',
      attachments: [INVOICE],
    };
    const { composer } = await renderAndUndo();

    expect(undoSendMessage).toHaveBeenCalledWith(
      { messageId: 'c1-queued' },
      expect.anything(),
    );
    expect(composer).toHaveTextContent('The invoice is attached.');
    expect(composer).toHaveTextContent('invoice.pdf');
  });

  it('hands back the files of a reply that carried no text', async () => {
    undone = { sourceMarkdown: null, attachments: [INVOICE] };
    await renderAndUndo();

    await waitFor(() =>
      expect(
        editor?.pendingMessage?.attachments?.map(attachedFileName),
      ).toEqual(['invoice.pdf']),
    );
    expect(editor?.pendingMessage?.content).toBe('');
  });

  it('re-sends a handed-back file by its stored blob, uploading nothing', async () => {
    undone = {
      sourceMarkdown: 'The invoice is attached.',
      attachments: [INVOICE],
    };
    await renderAndUndo();
    await waitFor(() =>
      expect(editor?.pendingMessage?.attachments).toHaveLength(1),
    );

    await editor?.onSave?.(
      '<p>The invoice is attached.</p>',
      editor.pendingMessage?.attachments,
      'The invoice is attached.',
    );

    expect(generateUploadUrl).not.toHaveBeenCalled();
    expect(sendMessageViaConnector).toHaveBeenCalledWith({
      conversationId: 'c1',
      organizationId: 'org1',
      content: '<p>The invoice is attached.</p>',
      sourceMarkdown: 'The invoice is attached.',
      attachments: [INVOICE],
    });
  });

  it('reads a server that hands back no files as a text-only draft', async () => {
    // A server from before the files were handed back (mid-roll).
    undone = { sourceMarkdown: 'The invoice is attached.' };
    await renderAndUndo();

    await waitFor(() =>
      expect(editor?.pendingMessage?.content).toBe('The invoice is attached.'),
    );
    expect(editor?.pendingMessage?.attachments).toEqual([]);
  });

  it('never seeds another conversation with the draft or its files', async () => {
    undone = {
      sourceMarkdown: 'The invoice is attached.',
      attachments: [INVOICE],
    };
    const { rerender } = await renderAndUndo();
    await waitFor(() =>
      expect(editor?.pendingMessage?.attachments).toHaveLength(1),
    );

    conversation = conversationFixture('c2');
    rerender(
      <ConversationPanel
        selectedConversationId="c2"
        onSelectedConversationChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(editor?.pendingMessage).toBeUndefined());
    expect(screen.queryByText('invoice.pdf')).not.toBeInTheDocument();
  });

  it("keeps each conversation's edited files after applying its undo seed", async () => {
    undone = { sourceMarkdown: 'Original invoice', attachments: [INVOICE] };
    const { rerender, user } = await renderAndUndo();
    await waitFor(() =>
      expect(editor?.pendingMessage?.attachments).toHaveLength(1),
    );

    await act(async () => {
      const seed = editor?.pendingMessage;
      if (!seed) throw new Error('Undo did not seed the editor');
      editor?.onAttachmentsChange?.(seed.attachments ?? []);
      editor?.onPendingMessageApplied?.(seed);
    });
    await waitFor(() => expect(editor?.pendingMessage).toBeUndefined());
    await act(async () => editor?.onAttachmentsChange?.([]));

    conversation = conversationFixture('c2');
    rerender(
      <ConversationPanel
        selectedConversationId="c2"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    const receipt = {
      ...INVOICE,
      storageId: 's3:org1/receipt',
      fileName: 'receipt.pdf',
    };
    undone = { sourceMarkdown: 'Other reply', attachments: [receipt] };
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(editor?.pendingMessage?.content).toBe('Other reply'),
    );
    await act(async () => {
      const seed = editor?.pendingMessage;
      if (!seed) throw new Error('Undo did not seed the editor');
      editor?.onAttachmentsChange?.(seed.attachments ?? []);
      editor?.onPendingMessageApplied?.(seed);
    });

    conversation = conversationFixture('c1');
    rerender(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(editor?.conversationId).toBe('c1'));
    expect(editor?.pendingMessage).toBeUndefined();
    expect(editor?.attachments).toEqual([]);
    await editor?.onSave?.(
      '<p>Edited reply</p>',
      editor.attachments,
      'Edited reply',
    );
    expect(sendMessageViaConnector).toHaveBeenLastCalledWith({
      conversationId: 'c1',
      organizationId: 'org1',
      content: '<p>Edited reply</p>',
      sourceMarkdown: 'Edited reply',
    });

    conversation = conversationFixture('c2');
    rerender(
      <ConversationPanel
        selectedConversationId="c2"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(editor?.conversationId).toBe('c2'));
    expect(editor?.pendingMessage).toBeUndefined();
    expect(editor?.attachments?.map(attachedFileName)).toEqual(['receipt.pdf']);
    await editor?.onSave?.(
      '<p>Other reply</p>',
      editor.attachments,
      'Other reply',
    );
    expect(sendMessageViaConnector).toHaveBeenLastCalledWith({
      conversationId: 'c2',
      organizationId: 'org1',
      content: '<p>Other reply</p>',
      sourceMarkdown: 'Other reply',
      attachments: [receipt],
    });
  });

  /**
   * An automation's drafted reply is a suggestion beside the composer, never
   * the composer's text: a person could not tell what they had typed from
   * what a model proposed when the proposal was simply written into the
   * editor. Taking it in is their act; so is discarding it.
   */
  it("keeps an automation's proposal beside the composer until the person decides", async () => {
    conversation.pendingApproval = {
      _id: 'approval1',
      _creationTime: 1,
      organizationId: 'org1',
      status: 'pending',
      resourceType: 'conversations',
      resourceId: 'c1',
      priority: 'medium',
      metadata: { emailBody: 'Prior proposal' },
    };
    const { rerender } = render(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    const card = await screen.findByRole('region', { name: 'Suggested reply' });
    expect(card).toHaveTextContent('Prior proposal');
    expect(editor?.pendingMessage).toBeUndefined();

    // Put in editor: the proposal becomes the composer's one-time seed and the
    // card gives way to a status line — the text is the person's from here.
    await act(async () => {
      screen.getByRole('button', { name: 'Put in editor' }).click();
    });
    await waitFor(() =>
      expect(editor?.pendingMessage?.content).toBe('Prior proposal'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The suggestion is in the editor.',
    );
    await act(async () => {
      const seed = editor?.pendingMessage;
      if (!seed) throw new Error('Taking the proposal did not seed the editor');
      editor?.onPendingMessageApplied?.(seed);
    });
    await waitFor(() => expect(editor?.pendingMessage).toBeUndefined());

    // A later proposal (another approval) is a new card, not a new seed.
    conversation = {
      ...conversation,
      pendingApproval: {
        ...conversation.pendingApproval,
        _id: 'approval2',
        metadata: { emailBody: 'Next proposal' },
      },
    };
    rerender(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole('region', { name: 'Suggested reply' }),
    ).toHaveTextContent('Next proposal');
    expect(editor?.pendingMessage).toBeUndefined();
  });

  it('discards a proposal by rejecting its approval', async () => {
    conversation.pendingApproval = {
      _id: 'approval1',
      _creationTime: 1,
      organizationId: 'org1',
      status: 'pending',
      resourceType: 'conversations',
      resourceId: 'c1',
      priority: 'medium',
      metadata: { emailBody: 'Prior proposal' },
    };
    render(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    const discard = await screen.findByRole('button', { name: 'Discard' });
    await act(async () => {
      discard.click();
    });
    expect(discardSuggestedReply).toHaveBeenCalledWith({
      approvalId: 'approval1',
      status: 'rejected',
    });
    expect(editor?.pendingMessage).toBeUndefined();
  });
});

/**
 * A single reply reaches a conversation by the reply door's own rule, the one
 * the bulk send shares (#3912): a conversation mirrored over the REST API
 * replies through its source without an address; any other needs its
 * contact's real address, and is refused before anything is sent.
 */
describe('ConversationPanel — who a single reply reaches', () => {
  beforeEach(() => {
    sendMessageViaConnector.mockClear();
  });

  function renderWithContact(channel: string, email: string) {
    const base = conversationFixture('c1');
    conversation = {
      ...base,
      channel,
      contact: { ...base.contact, email },
      messages: [],
    };
    render(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
  }

  it('sends a reply to a mirrored conversation without an email address', async () => {
    renderWithContact('api', '');
    await screen.findByRole('region', { name: 'Composer' });

    await editor?.onSave?.('<p>Hi</p>', undefined, 'Hi');

    expect(sendMessageViaConnector).toHaveBeenCalledWith({
      conversationId: 'c1',
      organizationId: 'org1',
      content: '<p>Hi</p>',
      sourceMarkdown: 'Hi',
    });
  });

  it.each(['', 'unknown@example.com'])(
    'refuses an email conversation whose contact address is %j, sending nothing',
    async (email) => {
      renderWithContact('email', email);
      await screen.findByRole('region', { name: 'Composer' });

      await expect(
        editor?.onSave?.('<p>Hi</p>', undefined, 'Hi'),
      ).rejects.toThrow('Cannot send email: contact email not found');
      expect(sendMessageViaConnector).not.toHaveBeenCalled();
    },
  );
});

describe('ConversationPanel — marking an opened conversation read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversation = conversationFixture('c1');
  });

  it.each([
    ['delayed', '2026-09-28T11:33:23.127Z'],
    ['normal', '2026-09-30T11:33:23.127Z'],
  ])(
    'marks a %s unread message read regardless of timestamp order',
    async (_kind, timestamp) => {
      conversation = {
        ...conversation,
        unread_count: 1,
        last_message_at: timestamp,
        last_read_at: '2026-09-29T11:33:23.175Z',
      };
      render(
        <ConversationPanel
          selectedConversationId="c1"
          onSelectedConversationChange={vi.fn()}
        />,
      );

      await waitFor(() =>
        expect(markAsRead).toHaveBeenCalledWith(
          { conversationId: 'c1' },
          expect.anything(),
        ),
      );
      expect(markAsRead).toHaveBeenCalledTimes(1);
    },
  );

  it('does not write for an already-read conversation even with a newer timestamp or no read marker', () => {
    conversation = {
      ...conversation,
      unread_count: 0,
      last_read_at: undefined,
    };
    const view = render(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    expect(markAsRead).not.toHaveBeenCalled();
    conversation = {
      ...conversation,
      last_read_at: '2026-09-01T00:00:00.000Z',
    };
    view.rerender(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    expect(markAsRead).not.toHaveBeenCalled();
  });

  it('uses refreshed unread state while the conversation remains open', async () => {
    const view = render(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    expect(markAsRead).not.toHaveBeenCalled();
    conversation = {
      ...conversation,
      unread_count: 1,
      last_message_at: '2026-09-01T00:00:00.000Z',
    };
    view.rerender(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(markAsRead).toHaveBeenCalledTimes(1));
    conversation = { ...conversation, unread_count: 0 };
    view.rerender(
      <ConversationPanel
        selectedConversationId="c1"
        onSelectedConversationChange={vi.fn()}
      />,
    );
    expect(markAsRead).toHaveBeenCalledTimes(1);
  });
});
