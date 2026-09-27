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
  useGenerateUploadUrl: () => ({ mutateAsync: generateUploadUrl }),
  useMarkAsRead: () => ({ mutate: vi.fn() }),
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
});
