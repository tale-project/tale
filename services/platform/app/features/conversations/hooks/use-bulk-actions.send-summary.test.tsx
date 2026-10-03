import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationItem } from '@/backend/core/conversations/types';
import { i18n } from '@/lib/i18n/i18n';
import { SHIPPED_LOCALES } from '@/tests/utils/lapsed-session';

import { useBulkActions } from './use-bulk-actions';

// Each send is quiet at its hook, so the bulk send's summary is the only
// report of a refused send, and it used to give the counts alone. The sends
// run for real — `useSendMessageViaConnector`, `useBackendMutation`, the
// adapter row, `backendFetch` — against the reply door's own answers, in
// each shipped language.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn() };
});

/** How the reply door refuses a conversation it cannot answer
 * (`backend/domains/conversations/send.ts`): its words, in English. */
const REFUSAL = {
  status: 409,
  body: {
    error: 'customer_email_not_found',
    message: 'Conversation has no contact email to reply to',
  },
} as const;

const conversations = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'conversations', ...options });

function conversation(
  id: string,
  email = `${id}@example.com`,
): ConversationItem {
  return {
    _id: id,
    id,
    contact: { id: `contact-${id}`, email },
  } as unknown as ConversationItem;
}

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof Request ? input.url : input.href;
}

/** The reply door answers every send, and refuses the conversations named. */
function replyDoorRefuses(refused: ReadonlySet<string>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const id = /\/conversations\/([^/?]+)\/reply/.exec(pathOf(input))?.[1];
    return id !== undefined && refused.has(id)
      ? Response.json(REFUSAL.body, { status: REFUSAL.status })
      : Response.json({ messageId: `message-${id}` });
  });
}

function renderBulkActions(list: ConversationItem[]) {
  const client = new QueryClient();
  return renderHook(
    () =>
      useBulkActions({
        organizationId: 'org-1',
        conversations: list,
        selectionState: { type: 'all' },
        onComplete: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

function summaries() {
  return vi.mocked(toast).mock.calls.map(([shown]) => ({
    title: shown.title,
    description: shown.description,
    variant: shown.variant,
  }));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe.each(SHIPPED_LOCALES)('the bulk send summary (%s)', (locale) => {
  beforeEach(async () => {
    await i18n.changeLanguage(locale);
  });

  it("names the first refused send's words beside the counts", async () => {
    const fetch = replyDoorRefuses(new Set(['conv-2']));
    const { result } = renderBulkActions([
      conversation('conv-1'),
      conversation('conv-2'),
      conversation('conv-3'),
    ]);

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    const counts = conversations('bulk.messagesSentDescription', {
      successCount: 2,
      failedCount: 1,
    });
    expect(summaries()).toEqual([
      {
        title: conversations('bulk.messagesSent'),
        description: conversations('bulk.outcomeWithReason', {
          outcome: counts,
          reason: REFUSAL.body.message,
        }),
        variant: 'default',
      },
    ]);
    const [{ description }] = summaries();
    expect(description).toContain(counts);
    expect(description).toContain(REFUSAL.body.message);
    expect(description).not.toMatch(/[{}]/);
  });

  it('words a conversation it could not address in the page language', async () => {
    replyDoorRefuses(new Set());
    const { result } = renderBulkActions([
      conversation('conv-1'),
      conversation('conv-2', 'unknown@example.com'),
      conversation('conv-3'),
    ]);

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    const reason = conversations('panel.contactEmailNotFound');
    expect(summaries()).toEqual([
      {
        title: conversations('bulk.messagesSent'),
        description: conversations('bulk.outcomeWithReason', {
          outcome: conversations('bulk.messagesSentDescription', {
            successCount: 2,
            failedCount: 1,
          }),
          reason,
        }),
        variant: 'default',
      },
    ]);
    expect(summaries()[0]?.description).toContain(reason);
  });

  it('keeps the counts alone when every send went out', async () => {
    replyDoorRefuses(new Set());
    const { result } = renderBulkActions([
      conversation('conv-1'),
      conversation('conv-2'),
    ]);

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    expect(summaries()).toEqual([
      {
        title: conversations('bulk.messagesSent'),
        description: conversations('bulk.messagesSentDescription', {
          successCount: 2,
          failedCount: 0,
        }),
        variant: 'default',
      },
    ]);
  });
});
