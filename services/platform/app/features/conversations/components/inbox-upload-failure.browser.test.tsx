import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

import type { Conversation } from '../types';
import { ComposeEmailPane } from './compose-email-pane';
import { ConversationPanel } from './conversation-panel';
import {
  messageDraftKeys,
  type MessageEditorProps,
} from './message-editor/types';

const consumed = vi.hoisted(() => vi.fn());
let conversation: Conversation;

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useAuth: () => ({ user: { userId: 'upload-test-user' } }),
}));
vi.mock('@/app/lib/backend/adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/adapters')>()),
  activeOrganizationId: () => 'org1',
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useConversationWithMessages: () => ({
    data: conversation,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMailboxes: () => ({ mailboxes: [] }),
  useEmailConnectors: () => ({
    isLoading: false,
    emailConnectors: [
      {
        credentialId: 'mailbox1',
        slug: 'imap-smtp',
        title: 'Support',
        type: 'imap_smtp',
        fromAddress: 'support@example.test',
      },
    ],
  }),
}));
vi.mock(
  '@/app/features/settings/organization/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/organization/hooks/queries')
    >()),
    useMembers: () => ({ members: [] }),
  }),
);
vi.mock(
  '@/app/features/settings/teams/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/teams/hooks/queries')
    >()),
    useOrgTeams: () => ({ teams: [] }),
  }),
);
vi.mock('@/app/hooks/use-current-member-context', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/hooks/use-current-member-context')
  >()),
  useCurrentMemberContext: () => ({ data: { role: 'admin' } }),
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
vi.mock('./contact-recipient-picker', () => ({
  ContactRecipientPicker: () => null,
}));
vi.mock('../hooks/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/actions')>()),
  useImproveMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));
// Keep the real editor and send/cleanup path; observe its success notification.
vi.mock('./message-editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./message-editor')>();
  return {
    ...actual,
    MessageEditor: (props: MessageEditorProps) => (
      <actual.MessageEditor
        {...props}
        onPendingMessageConsumed={() => {
          consumed();
          props.onPendingMessageConsumed?.();
        }}
      />
    ),
  };
});

const DRAFT = 'compose-upload-test-user-org1';
const adminAbility = defineAbilityFor('admin');
const keys = ['reply1', 'compose-org1'].flatMap((id) => {
  const draft = messageDraftKeys('upload-test-user', id);
  return [draft.body, draft.improveInstruction];
});
const composeKeys = [
  'contact',
  'subject',
  'mailbox',
  'sender',
  'inbox',
  'assignee',
  'assignee-team',
].map((key) => `${DRAFT}-${key}`);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of [...keys, ...composeKeys]) localStorage.removeItem(key);
  const now = new Date().toISOString();
  conversation = {
    _id: 'reply1',
    id: 'reply1',
    organizationId: 'org1',
    _creationTime: 1,
    title: 'Order 42',
    description: '',
    status: 'open',
    channel: 'email',
    contact: {
      id: 'contact1',
      email: 'customer@example.test',
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
        id: 'queued1',
        content: '<p>Original reply</p>',
        timestamp: now,
        sender: 'connector',
        isCustomer: false,
        status: 'queued',
        scheduledSendAt: Date.now() + 60_000,
      },
    ],
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const key of [...keys, ...composeKeys]) localStorage.removeItem(key);
});

type Surface = 'reply' | 'compose';
type Failure = 'mint' | 'refusal' | 'network' | 'malformed' | 'send' | 'none';

async function checkSendFailure(
  surface: Surface,
  initialFailure: Failure,
  body: string,
  undo = false,
) {
  let failure = initialFailure;
  const sent = vi.fn();
  const uploaded = vi.fn();
  const onSent = vi.fn();
  const onClose = vi.fn();
  const draft = messageDraftKeys(
    'upload-test-user',
    surface === 'reply' ? 'reply1' : 'compose-org1',
  );
  localStorage.setItem(
    draft.improveInstruction,
    JSON.stringify('Keep the friendly tone'),
  );
  localStorage.setItem(`${DRAFT}-contact`, JSON.stringify('contact1'));
  localStorage.setItem(`${DRAFT}-subject`, JSON.stringify('Quote 7'));
  localStorage.setItem(`${DRAFT}-mailbox`, JSON.stringify('mailbox1'));

  // Both panes use the real mutation hooks. Refuse the mint at their adapter
  // boundary, so a duplicate generic mutation toast cannot hide in a mock.
  const mint = WRITE_ADAPTERS['files/mutations:generateUploadUrl'];
  if (!mint) throw new Error('upload adapter missing');
  const originalMint = mint.run;
  vi.spyOn(mint, 'run').mockImplementation((args, ctx) => {
    if (failure === 'mint')
      return Promise.reject(
        new BackendApiError(403, 'Uploads are disabled', 'UPLOAD_REFUSED'),
      );
    return originalMint(args, ctx);
  });
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes('/files/upload')) {
      uploaded(init?.body);
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'refusal')
        return Response.json(
          {
            error: 'FILE_SIZE_INVALID',
            message: 'The file exceeds the 512 MiB limit',
          },
          { status: 413 },
        );
      if (failure === 'malformed') return Response.json({ storageId: null });
      return Response.json({ storageId: 's3:org1/invoice' });
    }
    if (url.includes('/messages/queued1/undo'))
      return Response.json({ sourceMarkdown: body });
    if (
      url.includes('/conversations/reply1/reply') ||
      url.includes('/conversations/compose')
    ) {
      sent(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
      if (failure === 'send')
        return Response.json(
          {
            error: 'MAILBOX_READ_ONLY',
            message: 'The mailbox cannot send email',
          },
          { status: 403 },
        );
      return Response.json({ conversationId: 'sent1', messageId: 'message1' });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { user, container } = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <AbilityContext.Provider value={adminAbility}>
        {surface === 'reply' ? (
          <ConversationPanel
            selectedConversationId="reply1"
            onSelectedConversationChange={onClose}
          />
        ) : (
          <ComposeEmailPane
            organizationId="org1"
            onSent={onSent}
            onClose={onClose}
          />
        )}
      </AbilityContext.Provider>
    </QueryClientProvider>,
  );
  const editorName =
    surface === 'reply' ? 'Type a message' : 'Write your message…';
  let textbox = await screen.findByRole(
    'textbox',
    { name: editorName },
    { timeout: 10_000 },
  );
  if (undo) {
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: editorName }),
      ).toHaveTextContent(body),
    );
    textbox = screen.getByRole('textbox', { name: editorName });
  } else if (body) {
    await user.click(textbox);
    await user.keyboard(body);
  }
  // Milkdown publishes markdown on its debounced listener. The persisted
  // draft, not only its immediate DOM paint, must be ready before sending.
  if (body) {
    await waitFor(() =>
      expect(localStorage.getItem(draft.body)).toContain(body),
    );
  }
  const file = new File(['%PDF-1.4'], 'invoice.pdf', {
    type: 'application/pdf',
  });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('missing file input');
  await user.upload(input, file);
  const bodyBefore = localStorage.getItem(draft.body);
  const send = screen.getByRole('button', { name: 'Send message' });
  await user.click(send);

  await waitFor(() => expect(toast).toHaveBeenCalled());
  await screen.findByRole('textbox', { name: editorName });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).not.toHaveAttribute('aria-busy', 'true'),
  );
  expect(consumed).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: editorName })).toBe(textbox);
  expect(send).toBeEnabled();
  if (body) expect(textbox).toHaveTextContent(body);
  expect(localStorage.getItem(draft.body)).toBe(bodyBefore);
  expect(localStorage.getItem(draft.improveInstruction)).toBe(
    JSON.stringify('Keep the friendly tone'),
  );
  expect(screen.getByText('invoice.pdf')).toBeVisible();
  expect(sent).toHaveBeenCalledTimes(initialFailure === 'send' ? 1 : 0);
  expect(onSent).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Couldn't send message. Try again.",
      variant: 'destructive',
    }),
  );
  if (
    initialFailure === 'refusal' ||
    initialFailure === 'mint' ||
    initialFailure === 'send'
  ) {
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          initialFailure === 'mint'
            ? 'Uploads are disabled'
            : initialFailure === 'send'
              ? 'The mailbox cannot send email'
              : 'The file exceeds the 512 MiB limit',
      }),
    );
  }
  if (surface === 'compose') {
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue(
      'Quote 7',
    );
    expect(localStorage.getItem(`${DRAFT}-contact`)).toBe(
      JSON.stringify('contact1'),
    );
  }

  failure = 'none';
  await user.click(send);
  await waitFor(() =>
    expect(sent).toHaveBeenCalledTimes(initialFailure === 'send' ? 2 : 1),
  );
  expect(uploaded).toHaveBeenLastCalledWith(file);
  expect(sent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ...(body
        ? { sourceMarkdown: JSON.parse(bodyBefore ?? '""') }
        : { content: '' }),
      attachments: [
        {
          storageId: 's3:org1/invoice',
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 8,
        },
      ],
    }),
  );
  await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(draft.body)).toBeNull();
  expect(localStorage.getItem(draft.improveInstruction)).toBeNull();
  expect(screen.queryByText('invoice.pdf')).not.toBeInTheDocument();
  if (surface === 'compose') {
    expect(onSent).toHaveBeenCalledExactlyOnceWith('sent1');
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  } else {
    expect(toast).toHaveBeenCalledTimes(1);
  }
}

describe.each<Surface>(['reply', 'compose'])(
  'Inbox %s send failures',
  (surface) => {
    it.each<{ name: string; failure: Failure; body: string }>([
      { name: 'refused upload mint', failure: 'mint', body: 'Keep my reply' },
      { name: 'refused upload', failure: 'refusal', body: 'Keep my reply' },
      { name: 'attachment-only network failure', failure: 'network', body: '' },
      {
        name: 'malformed upload response',
        failure: 'malformed',
        body: 'Keep my reply',
      },
      {
        name: 'refused send after upload',
        failure: 'send',
        body: 'Keep my reply',
      },
    ])(
      'preserves the draft and retries after $name',
      async ({ failure, body }) => {
        await checkSendFailure(surface, failure, body);
      },
      30_000,
    );
  },
);

it('keeps an undo-restored reply and its new attachment until resend succeeds', async () => {
  await checkSendFailure('reply', 'refusal', 'Undo restored reply', true);
}, 30_000);
