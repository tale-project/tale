/**
 * The Home panel's Inbox view over its real list read, selection and bulk
 * verbs: every request goes out through the app's adapters and
 * `backendFetch`, and only `fetch` is answered here, by a small model of the
 * Inbox doors — the list, and the bulk status verbs with the door's cap. The
 * viewer's directories and the router are stubbed as in
 * `home-inbox-list.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BULK_CONVERSATION_LIMIT } from '@/lib/shared/conversations/bulk-limit';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { HomeInboxList } from './home-inbox-list';

// jsdom has no layout. Give the real virtualizer a viewport and measured
// row heights; selection still runs against every loaded conversation.
vi.mock('@tale/ui/use-virtual-list', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tale/ui/use-virtual-list')>();
  return {
    ...original,
    useVirtualList: (options: Parameters<typeof original.useVirtualList>[0]) =>
      original.useVirtualList({
        ...options,
        observeElementRect: (_instance, callback) => {
          callback({ width: 280, height: 600 });
        },
        measureElement: () => 49,
      }),
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    search: _search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: unknown;
    search?: unknown;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-me' } }),
}));
vi.mock('@/app/features/conversations/hooks/use-inbox-channel-options', () => ({
  useInboxChannelOptions: () => [],
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
  useTeamNames: () => ({ nameOf: () => undefined, isLoading: false }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [], isLoading: false }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { status: 'ok', userId: 'user-me' },
  }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast,
}));

const ORG = 'org-1';

function projected(id: string, title: string) {
  return {
    _id: id,
    _creationTime: Date.now(),
    id,
    title,
    description: '',
    subject: title,
    status: 'open',
    unread_count: 1,
    last_message_at: new Date().toISOString(),
    messages: [],
  };
}

/** A projected row with its contact and lane, as the bulk send reads it. */
function addressed(
  id: string,
  title: string,
  extra: {
    channel: string;
    connectorName: string;
    contact: { id: string; name: string; email: string };
  },
) {
  return { ...projected(id, title), ...extra };
}

type Answer = Response | Promise<Response>;

/** The Inbox doors as the view reaches them. */
const door = {
  open: [] as (ReturnType<typeof projected> | ReturnType<typeof addressed>)[],
  /** Answers for the next list reads, in order; afterwards the open rows. */
  listAnswers: [] as Array<() => Answer>,
  listReads: 0,
  bulk: [] as { verb: string; ids: string[] }[],
  /** Answers for the next bulk requests, in order; afterwards the door's. */
  bulkAnswers: [] as Array<((ids: string[]) => Answer) | undefined>,
  /** Every reply the reply door took, in order, with its body. */
  replies: [] as { id: string; body: unknown }[],
  /** The conversations whose reply the door refuses, with its words. */
  refuseReplies: new Map<string, string>(),
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The bulk door: the cap, then the status flip, as the backend answers. */
function applyBulk(ids: string[]): Response {
  if (ids.length > BULK_CONVERSATION_LIMIT) {
    return json(400, {
      error: 'invalid body',
      message: `conversationIds: Too big: expected array to have <=${BULK_CONVERSATION_LIMIT} items`,
    });
  }
  door.open = door.open.filter((row) => !ids.includes(row.id));
  return json(200, { successCount: ids.length, failedCount: 0, errors: [] });
}

/** The address a `fetch` call names, whichever form it came in. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function answerFetch(input: RequestInfo | URL, init?: RequestInit): Answer {
  const url = new URL(urlOf(input), 'http://localhost');
  if (url.pathname === '/api/app/conversations') {
    door.listReads += 1;
    const answer = door.listAnswers.shift();
    if (answer) return answer();
    return json(200, { items: door.open, isDone: true, continueCursor: '' });
  }
  const bulk = /^\/api\/app\/conversations\/bulk\/(\w+)$/.exec(url.pathname);
  if (bulk?.[1] !== undefined) {
    const body: unknown = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    );
    const ids =
      typeof body === 'object' && body !== null && 'conversationIds' in body
        ? (body.conversationIds as string[])
        : [];
    door.bulk.push({ verb: bulk[1], ids });
    const answer = door.bulkAnswers.shift();
    return answer ? answer(ids) : applyBulk(ids);
  }
  const reply = /^\/api\/app\/conversations\/([^/]+)\/reply$/.exec(
    url.pathname,
  );
  if (reply?.[1] !== undefined) {
    const id = decodeURIComponent(reply[1]);
    const body: unknown = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    );
    door.replies.push({ id, body });
    const refusal = door.refuseReplies.get(id);
    return refusal === undefined
      ? json(200, { messageId: `message-${id}` })
      : json(409, { error: 'mailbox_paused', message: refusal });
  }
  return json(404, { error: 'Not found' });
}

function renderInbox() {
  const client = new QueryClient({
    // The production retry count, without its back-off wait.
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HomeInboxList
        organizationId={ORG}
        status="open"
        onStatusChange={vi.fn()}
        onInboxRoute={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  door.open = [];
  door.listAnswers = [];
  door.listReads = 0;
  door.bulk = [];
  door.bulkAnswers = [];
  door.replies = [];
  door.refuseReplies = new Map();
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', `/dashboard/${ORG}/conversations/open`);
  vi.spyOn(window, 'fetch').mockImplementation((input, init) =>
    Promise.resolve(answerFetch(input, init)),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  toast.mockReset();
  window.localStorage.clear();
});

const unavailable = () => json(503, { error: 'Service unavailable' });

describe('the Home Inbox over its real list read', () => {
  it('shows a refused read as a failure, and loads the rows on Try again', async () => {
    door.open = [projected('c1', 'Invoice shows the wrong VAT')];
    door.listAnswers = [
      () => json(403, { error: 'FORBIDDEN', message: 'Forbidden' }),
    ];
    const { user } = renderInbox();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load conversations");
    expect(screen.queryByText('No conversations')).not.toBeInTheDocument();
    // The failed status says nothing about what could be searched.
    expect(screen.getByPlaceholderText('Search conversations')).toBeEnabled();
    expect(door.listReads).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('link', { name: /Invoice shows the wrong VAT/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the failure once an unavailable backend used every retry', async () => {
    door.listAnswers = [unavailable, unavailable, unavailable, unavailable];
    renderInbox();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load conversations",
    );
    expect(door.listReads).toBe(4);
    expect(screen.queryByText('No conversations')).not.toBeInTheDocument();
  });

  it('still reads No conversations for a status that answered empty', async () => {
    renderInbox();

    expect(await screen.findByText('No conversations')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the Home Inbox bulk verbs over more rows than one request takes', () => {
  const COUNT = BULK_CONVERSATION_LIMIT + 1;
  // The source contains more conversations than a single bulk request takes.
  const HEAVY = 30_000;
  const WAIT = { timeout: 10_000 };

  async function selectEveryRow(user: ReturnType<typeof render>['user']) {
    const rows = await screen.findAllByRole(
      'checkbox',
      { name: 'Select conversation' },
      WAIT,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(COUNT);
    await user.click(rows[0]!);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('toolbar')).toHaveAccessibleName(
      `${COUNT} selected`,
    );
  }

  beforeEach(() => {
    // jsdom has no layout. Supply the scrollport and row sizes the real
    // virtualizer reads; the full selection still includes unmounted rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('overflow-y-auto') ? 600 : 48;
      },
    );
    door.open = Array.from({ length: COUNT }, (_, i) =>
      projected(`c${i}`, `Order ${i}`),
    );
  });

  it(
    'closes every selected conversation in requests the door takes',
    async () => {
      const { user } = renderInbox();
      await selectEveryRow(user);

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await waitFor(
        () => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument(),
        WAIT,
      );
      expect(door.bulk.map(({ verb, ids }) => [verb, ids.length])).toEqual([
        ['close', BULK_CONVERSATION_LIMIT],
        ['close', 1],
      ]);
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Conversations resolved',
          description: `Resolved ${COUNT} conversations`,
        }),
      );
      expect(
        await screen.findByText('No conversations', {}, WAIT),
      ).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'keeps what a refused request named selected, and says how many failed',
    async () => {
      door.bulkAnswers = [undefined, unavailable];
      const { user } = renderInbox();
      await selectEveryRow(user);

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await waitFor(
        () =>
          expect(screen.getByRole('toolbar')).toHaveAccessibleName(
            '1 selected',
          ),
        WAIT,
      );
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Conversations resolved',
          description: `Resolved ${BULK_CONVERSATION_LIMIT} conversations, 1 failed`,
          variant: 'default',
        }),
      );
      // The row the refused request named is still open, listed and ticked.
      const [remaining] = await screen.findAllByRole(
        'checkbox',
        { name: 'Select conversation' },
        WAIT,
      );
      expect(remaining).toHaveAttribute('aria-checked', 'true');
      expect(screen.getAllByRole('link', { name: /^Order / })).toHaveLength(1);
    },
    HEAVY,
  );

  it(
    'counts the requests off while they go out',
    async () => {
      let settleLast = (): void => {};
      door.bulkAnswers = [
        undefined,
        (ids) =>
          new Promise<Response>((resolve) => {
            settleLast = () => resolve(applyBulk(ids));
          }),
      ];
      const { user } = renderInbox();
      await selectEveryRow(user);

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(door.bulk).toHaveLength(2), WAIT);
      const progress = `Updating conversations... ${BULK_CONVERSATION_LIMIT} of ${COUNT}`;
      expect(screen.getByRole('status')).toHaveTextContent(progress);
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

      settleLast();
      await waitFor(
        () => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument(),
        WAIT,
      );
    },
    HEAVY,
  );
});

/**
 * Bulk Send over the real dialog, hooks and reply adapter: a conversation
 * mirrored over the REST API is reached without an address (#3912), and a
 * refused reply keeps the dialog, the message and only the refused
 * conversation, which Send then tries again alone (#3924).
 */
describe('the Home Inbox bulk Send over its real dialog and reply door', () => {
  const WAIT = { timeout: 10_000 };
  const TEXT = 'Use <price> & A&B\nThanks';
  const HTML = '<p>Use &lt;price&gt; &amp; A&amp;B<br>Thanks</p>';

  beforeEach(() => {
    door.open = [
      addressed('c-api', 'Order 1', {
        channel: 'api',
        connectorName: 'crm',
        contact: { id: 'k1', name: 'Alma', email: '' },
      }),
      addressed('c-alpha', 'Order 2', {
        channel: 'email',
        connectorName: 'gmail',
        contact: { id: 'k2', name: 'Alpha', email: 'alpha@example.com' },
      }),
      addressed('c-bravo', 'Order 3', {
        channel: 'email',
        connectorName: 'gmail',
        contact: { id: 'k3', name: 'Bravo', email: 'bravo@example.com' },
      }),
    ];
  });

  async function sendToEveryRow(user: ReturnType<typeof render>['user']) {
    const [first] = await screen.findAllByRole(
      'checkbox',
      { name: 'Select conversation' },
      WAIT,
    );
    await user.click(first!);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('toolbar')).toHaveAccessibleName('3 selected');
    await user.click(screen.getByRole('button', { name: 'Send messages' }));
    const dialog = await screen.findByRole('dialog', {}, WAIT);
    const field = within(dialog).getByRole('textbox', { name: 'Message' });
    await user.type(field, 'Use <price> & A&B{Enter}Thanks');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    return { dialog, field };
  }

  it('reaches the mirrored conversation and retries only the refused one', async () => {
    door.refuseReplies.set('c-bravo', 'The Bravo mailbox is paused');
    const { user } = renderInbox();

    const { dialog, field } = await sendToEveryRow(user);

    const alert = await within(dialog).findByRole('alert', {}, WAIT);
    expect(door.replies).toEqual(
      ['c-api', 'c-alpha', 'c-bravo'].map((id) => ({
        id,
        body: { content: HTML, sourceMarkdown: TEXT },
      })),
    );
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Messages sent',
        description: 'Sent 2 messages, 1 failed — The Bravo mailbox is paused',
        variant: 'default',
      }),
    );
    expect(alert).toHaveTextContent("1 message wasn't sent");
    expect(within(alert).getByRole('listitem')).toHaveTextContent(
      'Bravo — The Bravo mailbox is paused',
    );
    expect(dialog).toHaveAccessibleName('Send 1 Message');
    expect(field).toHaveValue(TEXT);
    expect(field).toHaveFocus();
    // Behind the modal, only the refused conversation is still selected.
    expect(screen.getByRole('toolbar', { hidden: true })).toHaveAccessibleName(
      '1 selected',
    );

    door.refuseReplies.clear();
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(
      () => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      WAIT,
    );
    expect(door.replies.map(({ id }) => id)).toEqual([
      'c-api',
      'c-alpha',
      'c-bravo',
      'c-bravo',
    ]);
    expect(door.replies.at(-1)?.body).toEqual({
      content: HTML,
      sourceMarkdown: TEXT,
    });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('keeps the message and every selected conversation when nothing went out', async () => {
    door.open = [
      ...door.open.slice(0, 2),
      addressed('c-none', 'Order 4', {
        channel: 'email',
        connectorName: 'gmail',
        contact: { id: 'k4', name: 'Nadia', email: 'unknown@example.com' },
      }),
    ];
    door.refuseReplies.set('c-api', 'The CRM source is paused');
    door.refuseReplies.set('c-alpha', 'The Alpha mailbox is paused');
    const { user } = renderInbox();

    const { dialog, field } = await sendToEveryRow(user);

    const alert = await within(dialog).findByRole('alert', {}, WAIT);
    // The conversation without an address never reaches the door.
    expect(door.replies.map(({ id }) => id)).toEqual(['c-api', 'c-alpha']);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Sent 0 messages, 3 failed — The CRM source is paused',
        variant: 'destructive',
      }),
    );
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Alma — The CRM source is paused',
      'Alpha — The Alpha mailbox is paused',
      'Nadia — Cannot send email: contact email not found',
    ]);
    expect(field).toHaveValue(TEXT);
    expect(screen.getByRole('toolbar', { hidden: true })).toHaveAccessibleName(
      '3 selected',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('toolbar')).toHaveAccessibleName('3 selected');
    expect(door.replies).toHaveLength(2);
  });
});
