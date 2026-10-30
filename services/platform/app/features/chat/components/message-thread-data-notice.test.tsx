// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataNoticeDismissalKey } from '@/app/features/governance/hooks/use-shown-data-notice';
import {
  dataNoticeBootKey,
  toCssString,
} from '@/app/features/governance/lib/data-notice-boot';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, within } from '@/tests/utils/render';

import { toSettledItems } from '../lib/thread-view-core';
import type { ChatMessageItem, ChatMessageView } from '../types';
import { MessageThread } from './message-thread';

/**
 * The confidentiality notice on a conversation's last message, through the
 * real rows: the org's policy read and the signed-in member are the seams.
 * `policy: undefined` is a read still loading, `null` an org without a
 * policy file, an object the stored policy.
 */
const seams = vi.hoisted(() => ({
  policy: undefined as unknown,
  userId: 'user-1',
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: seams.policy }),
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: seams.userId } }),
}));

// Image-attachment parts resolve display URLs through a backend read; this
// harness renders without a provider, so the seam answers inert.
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

// Counts the toolbar's renders: the notice reads its own state, so neither
// its dismissal nor its move to a new reply may render a reply's chrome
// more than the thread already does (#4121). The wrapper renders the real
// toolbar.
const toolbarRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./message-toolbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./message-toolbar')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    MessageToolbar: (props: Parameters<typeof actual.MessageToolbar>[0]) => {
      toolbarRenders.count += 1;
      return createElement(actual.MessageToolbar, props);
    },
  };
});

const NOTICE = 'Never paste client names into chat.';
const DISMISSAL_KEY = dataNoticeDismissalKey('user-1', 'org-1');

function policyShowing(text: string) {
  return { config: { enabled: true, messages: { en: text } } };
}

/** `count` question-and-answer turns: settled user and assistant rows. */
function turns(count: number): ChatMessageView[] {
  const rows: ChatMessageView[] = [];
  for (let index = 1; index <= count; index += 1) {
    rows.push(
      {
        id: `u${index}`,
        role: 'user',
        sequence: index * 2 - 1,
        createdAt: index * 2 - 1,
        parts: [
          { type: 'text', text: `Question ${index}: why do tides turn?` },
        ],
      },
      {
        id: `a${index}`,
        role: 'assistant',
        sequence: index * 2,
        createdAt: index * 2,
        parts: [{ type: 'text', text: `Answer ${index}. The moon moves on.` }],
      },
    );
  }
  return rows;
}

/** The chat surface's transcript: it asks for the notice. */
function thread(messages: readonly ChatMessageItem[], isGenerating = false) {
  return (
    <MessageThread
      messages={messages}
      organizationId="org-1"
      threadId="t-1"
      threadRootId="t-1"
      isGenerating={isGenerating}
      dataNotice
    />
  );
}

/** The next reply streaming in under the second question. */
const STREAMING_REPLY: ChatMessageItem = {
  id: 'a2',
  key: 'a2',
  role: 'assistant',
  sequence: 4,
  createdAt: 4,
  parts: [],
  text: '',
  isStreaming: true,
  isFinalReveal: false,
};

const rows = () => screen.getAllByTestId('chat-message');
const lastRow = () => rows().at(-1)!;
const notices = () =>
  screen.queryAllByRole('note', { name: 'Confidentiality notice' });
const noticeIn = (row: HTMLElement) =>
  within(row).queryByRole('note', { name: 'Confidentiality notice' });

beforeEach(() => {
  seams.policy = policyShowing(NOTICE);
  seams.userId = 'user-1';
});

afterEach(() => {
  window.localStorage.clear();
});

describe('MessageThread confidentiality notice', () => {
  it('shows the notice on the last message only, under its toolbar', () => {
    render(thread(toSettledItems(turns(2))));

    expect(notices()).toHaveLength(1);
    const notice = noticeIn(lastRow());
    expect(notice).toHaveTextContent(NOTICE);
    const copy = within(lastRow()).getByRole('button', { name: 'Copy' });
    expect(
      copy.compareDocumentPosition(notice as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('moves the notice to the newest reply as the conversation grows', () => {
    const items = toSettledItems(turns(1));
    const { rerender } = render(thread(items));
    const firstReply = lastRow();
    expect(noticeIn(firstReply)).not.toBeNull();

    rerender(thread([...items, ...toSettledItems(turns(2).slice(2))]));

    expect(noticeIn(firstReply)).toBeNull();
    expect(noticeIn(lastRow())).not.toBeNull();
    expect(notices()).toHaveLength(1);
  });

  it('holds the notice back while a turn runs', () => {
    const items = toSettledItems(turns(1));
    const question = toSettledItems(turns(2).slice(2, 3));
    const { rerender } = render(thread([...items, ...question], true));

    // Neither under the prompt just sent nor left on the reply above it.
    expect(notices()).toHaveLength(0);

    rerender(thread([...items, ...question, STREAMING_REPLY], true));

    expect(notices()).toHaveLength(0);
  });

  it('shows the notice under a reply once it settles', () => {
    vi.useFakeTimers();
    try {
      const items = [
        ...toSettledItems(turns(1)),
        ...toSettledItems(turns(2).slice(2, 3)),
      ];
      const { rerender } = render(thread([...items, STREAMING_REPLY], true));
      const text = 'Answer 2. The moon moves on.';

      rerender(
        thread([
          ...items,
          {
            ...STREAMING_REPLY,
            parts: [{ type: 'text', text }],
            text,
            isStreaming: false,
          },
        ]),
      );
      // It waits with the toolbar for the reveal to finish.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(noticeIn(lastRow())).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the notice under your own message when it is the last one and no turn runs', () => {
    render(
      thread([
        ...toSettledItems(turns(1)),
        ...toSettledItems(turns(2).slice(2, 3)),
      ]),
    );

    expect(lastRow()).toHaveAttribute('data-message-role', 'user');
    expect(noticeIn(lastRow())).not.toBeNull();
  });

  it.each([
    ['the policy read has no answer yet', undefined],
    ['the org has no policy file', null],
    ['the org keeps the notice off', { config: { enabled: false } }],
  ])('shows nothing while %s', (_case, policy) => {
    seams.policy = policy;

    render(thread(toSettledItems(turns(1))));

    expect(notices()).toHaveLength(0);
  });

  it('shows nothing on a transcript that does not ask for it', () => {
    // A shared snapshot or an arena column.
    render(
      <MessageThread
        messages={toSettledItems(turns(1))}
        organizationId="org-1"
        threadId="t-1"
      />,
    );

    expect(notices()).toHaveLength(0);
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])(
    'hides the notice with %s and keeps it hidden after a reload',
    async (_key, keys) => {
      window.localStorage.setItem(
        dataNoticeBootKey('org-1'),
        toCssString(NOTICE),
      );
      const { user, unmount } = render(thread(toSettledItems(turns(1))));
      const reply = lastRow();
      const dismiss = within(reply).getByRole('button', {
        name: "Don't show again",
      });
      const replyActions = within(reply)
        .getAllByRole('button')
        .filter((button) => button !== dismiss);
      const lastAction = replyActions.at(-1)!;

      // Reached with Tab right after the reply's own actions.
      lastAction.focus();
      await user.tab();
      expect(dismiss).toHaveFocus();
      await user.keyboard(keys);

      expect(notices()).toHaveLength(0);
      // Focus stays in the message instead of falling back to the page.
      expect(lastAction).toHaveFocus();
      expect(window.localStorage.getItem(DISMISSAL_KEY)).toBe(
        JSON.stringify(NOTICE),
      );
      // The next new chat's skeleton reserves no row for it either.
      expect(
        window.localStorage.getItem(dataNoticeBootKey('org-1')),
      ).toBeNull();

      unmount();
      render(thread(toSettledItems(turns(1))));

      expect(notices()).toHaveLength(0);
    },
  );

  it('shows the notice again once the org changes its text', () => {
    window.localStorage.setItem(DISMISSAL_KEY, JSON.stringify(NOTICE));
    const { unmount } = render(thread(toSettledItems(turns(1))));
    expect(notices()).toHaveLength(0);
    unmount();

    seams.policy = policyShowing('Never paste client names or salaries.');
    render(thread(toSettledItems(turns(1))));

    expect(noticeIn(lastRow())).toHaveTextContent(
      'Never paste client names or salaries.',
    );
  });

  it("keeps a member's dismissal to that member and organization", () => {
    window.localStorage.setItem(
      dataNoticeDismissalKey('user-2', 'org-1'),
      JSON.stringify(NOTICE),
    );
    window.localStorage.setItem(
      dataNoticeDismissalKey('user-1', 'org-2'),
      JSON.stringify(NOTICE),
    );

    render(thread(toSettledItems(turns(1))));

    expect(notices()).toHaveLength(1);
  });

  it('renders no reply again when the notice is dismissed', async () => {
    const { user } = render(thread(toSettledItems(turns(3))));
    toolbarRenders.count = 0;

    await user.click(screen.getByRole('button', { name: "Don't show again" }));

    expect(notices()).toHaveLength(0);
    expect(toolbarRenders.count).toBe(0);
  });

  it('renders two toolbars on a send with the notice on, as without it', () => {
    const items = toSettledItems(turns(3));
    const { rerender } = render(thread(items));
    toolbarRenders.count = 0;

    rerender(thread([...items, ...toSettledItems(turns(4).slice(6))]));

    // The new reply's, and the previous reply's, which is no longer last.
    expect(toolbarRenders.count).toBe(2);
    expect(notices()).toHaveLength(1);
  });

  it('passes an axe audit with the notice shown', async () => {
    const { container } = render(thread(toSettledItems(turns(1))));

    expect(notices()).toHaveLength(1);
    await checkAccessibility(container);
  });
});
