import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { ConversationItem } from '@/backend/core/conversations/types';
import { AppError } from '@/lib/shared/errors/app-error';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import '@/app/globals.css';

import { useInboxList } from '../hooks/use-inbox-list';
import { BulkSendDialog } from './bulk-send-dialog';

/**
 * The bulk send in real Chromium, over the real list, selection and bulk
 * hooks, the real dialog and the shared ConfirmDialog. Only the reply write
 * is a stand-in that answers in memory: nothing is delivered.
 */
const reply = vi.hoisted(() => ({
  refuse: new Map<string, string>(),
  hold: null as null | Promise<void>,
  sent: [] as { conversationId: string; content: string }[],
}));

vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useSendMessageViaConnector: () => ({
    mutateAsync: async (args: { conversationId: string; content: string }) => {
      reply.sent.push(args);
      if (reply.hold) await reply.hold;
      const refusal = reply.refuse.get(args.conversationId);
      if (refusal !== undefined) {
        throw new AppError({ code: 'mailbox_paused', message: refusal });
      }
      return `message-${args.conversationId}`;
    },
  }),
}));
vi.mock(
  '@/app/features/settings/teams/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/teams/hooks/queries')
    >()),
    useTeams: () => ({ teams: [], isLoading: false }),
    useTeamNames: () => ({ nameOf: () => undefined, isLoading: false }),
  }),
);
vi.mock(
  '@/app/features/settings/organization/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/organization/hooks/queries')
    >()),
    useMembers: () => ({ members: [], isLoading: false }),
  }),
);
vi.mock('@/app/hooks/use-current-member-context', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/hooks/use-current-member-context')
  >()),
  useCurrentMemberContext: () => ({
    data: { status: 'ok', userId: 'user-me' },
  }),
}));
vi.mock('@/app/hooks/use-ability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-ability')>()),
  useAbility: () => ({ can: () => true }),
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

function row(
  id: string,
  name: string,
  channel: string,
  email: string,
): ConversationItem {
  return {
    _id: id,
    id,
    title: `Order ${id}`,
    channel,
    unread_count: 0,
    contact: { id: `contact-${id}`, name, email },
  } as unknown as ConversationItem;
}

const ROWS = [
  row('api', 'Alma', 'api', ''),
  row('alpha', 'Alpha', 'email', 'alpha@example.com'),
  row('bravo', 'Bravo', 'email', 'bravo@example.com'),
];

function Inbox({ rows }: { rows: ConversationItem[] }) {
  const { selection, bulk } = useInboxList({
    organizationId: 'org-1',
    rows,
    searchQuery: '',
    onSearchChange: () => {},
    readFilter: 'all',
    assigneeSelection: [],
  });
  return (
    <main>
      <p>{`${selection.selectedCount} selected`}</p>
      <button type="button" onClick={() => selection.handleSelectAll(true)}>
        Select all
      </button>
      <button type="button" onClick={bulk.openBulkSendDialog}>
        Send messages
      </button>
      {bulk.bulkSendDialog.isOpen && (
        <BulkSendDialog
          selectedCount={selection.selectedCount}
          isSending={bulk.bulkSendDialog.isSending}
          refused={bulk.bulkSendDialog.refused}
          onConfirm={bulk.handleSendMessages}
          onCancel={bulk.closeBulkSendDialog}
        />
      )}
    </main>
  );
}

function renderInbox(rows = ROWS) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Inbox rows={rows} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderRows: (next: ConversationItem[]) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <Inbox rows={next} />
        </QueryClientProvider>,
      ),
  };
}

async function openWithMessage() {
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
  await userEvent.click(screen.getByRole('button', { name: 'Send messages' }));
  const dialog = await screen.findByRole('dialog');
  const field = within(dialog).getByRole('textbox', { name: 'Message' });
  await userEvent.fill(field, 'Use <price> & A&B\nThanks');
  return { dialog, field };
}

beforeEach(() => {
  reply.refuse.clear();
  reply.hold = null;
  reply.sent = [];
});

afterEach(() => {
  cleanup();
});

describe('bulk Send in Chromium', () => {
  it('reaches the mirrored conversation, then keeps the message and focus on it over a refusal, and retries only the refused one', async () => {
    reply.refuse.set('bravo', 'The Bravo mailbox is paused');
    renderInbox();
    const { dialog, field } = await openWithMessage();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    const alert = await within(dialog).findByRole('alert');
    expect(reply.sent.map(({ conversationId }) => conversationId)).toEqual([
      'api',
      'alpha',
      'bravo',
    ]);
    expect(alert).toHaveTextContent("1 message wasn't sent");
    expect(alert).toHaveTextContent('Bravo — The Bravo mailbox is paused');
    expect(dialog).toHaveAccessibleName('Send 1 Message');
    expect(field).toHaveValue('Use <price> & A&B\nThanks');
    // Send was disabled while it ran; focus is back on the message.
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    reply.refuse.clear();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(reply.sent.map(({ conversationId }) => conversationId)).toEqual([
      'api',
      'alpha',
      'bravo',
      'bravo',
    ]);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('holds Escape and Cancel while it sends, then keeps the message over a refusal', async () => {
    let release = () => {};
    reply.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    reply.refuse.set('api', 'The CRM source is paused');
    reply.refuse.set('alpha', 'The Alpha mailbox is paused');
    reply.refuse.set('bravo', 'The Bravo mailbox is paused');
    renderInbox();
    const { dialog, field } = await openWithMessage();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(field).toBeDisabled());
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(reply.sent).toHaveLength(3);

    release();

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent("3 messages weren't sent");
    expect(field).toHaveValue('Use <price> & A&B\nThanks');
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(reply.sent).toHaveLength(3);
  });

  it('keeps the message when the list refreshes under the open dialog', async () => {
    const { rerenderRows } = renderInbox();
    const { dialog, field } = await openWithMessage();
    expect(dialog).toHaveAccessibleName('Send 3 Messages');

    rerenderRows(ROWS.slice(1));

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName(
        'Send 2 Messages',
      ),
    );
    expect(field).toHaveValue('Use <price> & A&B\nThanks');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(reply.sent.map(({ conversationId }) => conversationId)).toEqual([
      'alpha',
      'bravo',
    ]);
  });
});
