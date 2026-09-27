import '@testing-library/jest-dom/vitest';
import { ListenerManager } from '@milkdown/kit/plugin/listener';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
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
// oxlint-disable-next-line typescript/unbound-method -- the spy forwards with call(this, callback), preserving the original listener manager.
const originalMarkdownUpdated = ListenerManager.prototype.markdownUpdated;
const publication = { latest: '', hold: false, updates: 0 };
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
  publication.latest = '';
  publication.hold = false;
  publication.updates = 0;
  // Widen the real debounce gap at its public publication boundary. The
  // document, transactions and both serializers stay real; no wall-clock race
  // is needed for the app's persisted draft to lag behind what is visible.
  vi.spyOn(ListenerManager.prototype, 'markdownUpdated').mockImplementation(
    function (this: ListenerManager, callback) {
      return originalMarkdownUpdated.call(this, (...args) => {
        publication.latest = args[1];
        publication.updates += 1;
        if (!publication.hold) callback(...args);
      });
    },
  );
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

type DraftCase = 'initial' | 'edited' | 'cleared' | 'empty';

async function checkSnapshot(
  surface: Surface,
  draftCase: DraftCase,
  attach = true,
) {
  const sent = vi.fn();
  const draft = messageDraftKeys(
    'upload-test-user',
    surface === 'reply' ? 'reply1' : 'compose-org1',
  );
  const initial =
    draftCase === 'edited' || draftCase === 'cleared' ? 'Original draft' : '';
  if (initial) localStorage.setItem(draft.body, JSON.stringify(initial));
  localStorage.setItem(`${DRAFT}-contact`, JSON.stringify('contact1'));
  localStorage.setItem(`${DRAFT}-subject`, JSON.stringify('Quote 7'));
  localStorage.setItem(`${DRAFT}-mailbox`, JSON.stringify('mailbox1'));

  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes('/files/upload'))
      return Response.json({ storageId: 's3:org1/invoice' });
    if (
      url.includes('/conversations/reply1/reply') ||
      url.includes('/conversations/compose')
    ) {
      sent(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
      return Response.json({ conversationId: 'sent1', messageId: 'message1' });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

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
            onSelectedConversationChange={vi.fn()}
          />
        ) : (
          <ComposeEmailPane
            organizationId="org1"
            onSent={vi.fn()}
            onClose={vi.fn()}
          />
        )}
      </AbilityContext.Provider>
    </QueryClientProvider>,
  );
  const editorName =
    surface === 'reply' ? 'Type a message' : 'Write your message…';
  const editor = await screen.findByRole(
    'textbox',
    { name: editorName },
    { timeout: 10_000 },
  );
  const send = screen.getByRole('button', { name: 'Send message' });
  if (attach) {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('missing file input');
    await user.upload(
      input,
      new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() => expect(send).toBeEnabled());
  }

  publication.hold = true;
  publication.updates = 0;
  const expected =
    draftCase === 'initial'
      ? 'Urgent reply'
      : draftCase === 'edited'
        ? 'Original draft plus the latest edit'
        : '';
  if (draftCase !== 'empty') {
    await user.click(editor);
    if (initial) await user.clear(editor);
    if (expected) await user.keyboard(expected);
    expect(editor.textContent).toBe(expected);
    await waitFor(() => {
      expect(publication.updates).toBeGreaterThan(0);
      expect(publication.latest.trim()).toBe(expected);
    });
  }
  // Assert the stale React draft explicitly; a slow machine cannot silently
  // turn this into the wait-for-draft path that hid the original bug.
  expect(localStorage.getItem(draft.body)).toBe(
    initial ? JSON.stringify(initial) : null,
  );
  if (!attach && !expected) {
    expect(send).toBeDisabled();
    expect(sent).not.toHaveBeenCalled();
    return;
  }

  await user.click(send);
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(sent).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expected ? `<p>${expected}</p>` : '',
      ...(expected
        ? { sourceMarkdown: expect.stringContaining(expected) }
        : {}),
    }),
  );
  if (!expected)
    expect(sent.mock.calls[0]?.[0]).not.toHaveProperty('sourceMarkdown');
  if (attach)
    expect(sent.mock.calls[0]?.[0].attachments).toEqual([
      {
        storageId: 's3:org1/invoice',
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 8,
      },
    ]);
  await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(draft.body)).toBeNull();
  expect(
    (await screen.findByRole('textbox', { name: editorName })).textContent,
  ).toBe('');
}

describe.each<Surface>(['reply', 'compose'])(
  'Inbox %s live send snapshot',
  (surface) => {
    it.each<DraftCase>(['initial', 'edited', 'cleared', 'empty'])(
      'sends the visible document while the %s draft is unpublished',
      async (draftCase) => {
        await checkSnapshot(surface, draftCase);
      },
      30_000,
    );
    it('keeps Send disabled for an empty editor without files', async () => {
      await checkSnapshot(surface, 'empty', false);
    }, 30_000);
  },
);
