// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundPaginatedQueryResult } from '../../hooks/use-bound-paginated-query';
import { ViewStateProvider } from '../../runtime/view-state';
import {
  ConversationList,
  type ConversationListProps,
  isUnreadValue,
  readCountValue,
} from './conversation-list';

// i18n → echo `ns.key`, interpolating params, so assertions read clearly.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`,
  }),
}));

// Date formatting is not under test — stable labels.
vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: () => 'time-label',
    formatDateSmart: () => 'smart-date',
    formatDateHeader: () => 'date-header',
  }),
}));

// The paginated data hook — driven by hand per test; capture merged args.
let paginatedReturn: BoundPaginatedQueryResult;
let lastPaginatedArgs: unknown;
vi.mock('../../hooks/use-bound-paginated-query', () => ({
  useBoundPaginatedQuery: (_path: string, args: unknown) => {
    lastPaginatedArgs = args;
    return paginatedReturn;
  },
}));

// The secondary count query.
let countReturn: { data: unknown; isLoading: boolean; blocked: boolean };
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => countReturn,
}));

// Bound actions (onOpen + bulk): one shared dispatch spy.
const dispatch = vi.fn();
vi.mock('../../hooks/use-bound-action', () => ({
  useBoundAction: () => ({ dispatch, isPending: false }),
}));

const applyEffect = vi.fn();
vi.mock('../../runtime/action-effects', () => ({
  useActionEffect: () => applyEffect,
}));

const loadMore = vi.fn();

function paginated(
  over: Partial<BoundPaginatedQueryResult>,
): BoundPaginatedQueryResult {
  return {
    results: [],
    status: 'Exhausted',
    isLoading: false,
    loadMore,
    blocked: false,
    needsConfig: false,
    ...over,
  };
}

const ITEM: ConversationListProps['item'] = {
  titleField: 'title',
  senderField: 'sender',
  previewField: 'preview',
  timestampField: 'lastMessageAt',
  unreadField: 'unread_count',
  badgeField: 'status',
};

const BASE: ConversationListProps = {
  query: { path: 'conversations/queries:listConversationsPaginated', args: {} },
  perPage: 30,
  item: ITEM,
  selection: { stateKey: 'conversationId', idField: '_id' },
};

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `c_${i}`,
    title: `Subject ${i}`,
    sender: `Sender ${i}`,
    preview: '<p>Hello&nbsp;preview</p>',
    lastMessageAt: 1_700_000_000_000,
    unread_count: i === 0 ? 2 : 0,
    status: 'open',
  }));
}

function renderList(props: Partial<ConversationListProps> = {}) {
  return render(
    <ViewStateProvider>
      <ConversationList {...BASE} {...props} />
    </ViewStateProvider>,
  );
}

afterEach(() => {
  dispatch.mockReset();
  applyEffect.mockClear();
  loadMore.mockClear();
  lastPaginatedArgs = undefined;
  countReturn = { data: undefined, isLoading: false, blocked: false };
});

describe('ConversationList — rows via the item field map', () => {
  it('renders sender, subject, cleaned preview, timestamp, unread dot and status badge', () => {
    paginatedReturn = paginated({ results: rows(2) });
    renderList();

    expect(screen.getByText('Sender 0')).toBeInTheDocument();
    expect(screen.getByText('Subject 0')).toBeInTheDocument();
    // HTML stripped + entity decoded, single line.
    expect(screen.getAllByText('Hello preview')).toHaveLength(2);
    expect(screen.getAllByText('smart-date')).toHaveLength(2);
    // Only the first row is unread (visually a dot; announced via sr-only text).
    expect(screen.getAllByText('common.aria.unread')).toHaveLength(1);
    expect(screen.getAllByText('open')).toHaveLength(2);
  });

  it('marks the clicked row as current and dispatches onOpen with the row', async () => {
    paginatedReturn = paginated({ results: rows(2) });
    dispatch.mockResolvedValue({ ok: true });
    const onOpen = {
      path: 'conversations/mutations:markAsRead',
      mode: 'mutation' as const,
      args: { conversationId: '$selected._id' },
      onSuccess: { kind: 'toast' as const, titleKey: 'opened' },
    };
    renderList({ onOpen });

    const row = screen.getByRole('button', { name: 'Subject 1' });
    expect(row).not.toHaveAttribute('aria-current');
    await userEvent.click(row);

    expect(row).toHaveAttribute('aria-current', 'true');
    expect(dispatch).toHaveBeenCalledWith(
      onOpen.args,
      expect.objectContaining({ _id: 'c_1' }),
    );
    expect(applyEffect).toHaveBeenCalledWith(
      onOpen.onSuccess,
      { ok: true },
      expect.objectContaining({ _id: 'c_1' }),
    );
  });
});

describe('ConversationList — bulk selection', () => {
  const BULK = [
    {
      label: 'Archive',
      path: 'conversations/mutations:bulkArchive',
      mode: 'mutation' as const,
      args: { ids: '$selection.ids' },
    },
  ];

  it('shows checkboxes only when bulkActions are configured', () => {
    paginatedReturn = paginated({ results: rows(1) });
    renderList();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('dispatches each bulk action with its own selection ids, then clears', async () => {
    paginatedReturn = paginated({ results: rows(3) });
    dispatch.mockResolvedValue(null);
    renderList({ bulkActions: BULK });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[2]);

    expect(screen.getByText('common.labels.nSelected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(dispatch).toHaveBeenCalledWith(
      { ids: '$selection.ids' },
      undefined,
      {
        selectionIds: ['c_0', 'c_2'],
      },
    );
    // The toolbar clears with the selection.
    expect(
      screen.queryByText('common.labels.nSelected'),
    ).not.toBeInTheDocument();
  });
});

describe('ConversationList — filters, count, paging, framing states', () => {
  it('merges the toggled chip value into the bound query args and clears it', async () => {
    paginatedReturn = paginated({ results: rows(1) });
    renderList({
      query: { path: BASE.query.path, args: { organizationId: 'o1' } },
      filters: [{ field: 'status', values: ['open', 'closed'] }],
    });

    expect(lastPaginatedArgs).toEqual({ organizationId: 'o1' });
    await userEvent.click(screen.getByRole('button', { name: 'closed' }));
    expect(lastPaginatedArgs).toEqual({
      organizationId: 'o1',
      status: 'closed',
    });
    await userEvent.click(screen.getByRole('button', { name: 'closed' }));
    expect(lastPaginatedArgs).toEqual({ organizationId: 'o1' });
  });

  it('resolves filter-chip valueLabels while dispatching the raw value', async () => {
    paginatedReturn = paginated({ results: rows(1) });
    renderList({
      filters: [
        {
          field: 'status',
          values: ['open', 'closed'],
          valueLabels: { closed: 'Closed' },
        },
      ],
    });

    // Mapped chip shows its literal label; unmapped stays the raw value.
    const chip = screen.getByRole('button', { name: 'Closed' });
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();

    // The raw value still travels as the query arg.
    await userEvent.click(chip);
    expect(lastPaginatedArgs).toEqual({ status: 'closed' });
  });

  it('resolves the item status badge via badgeLabels; unmapped renders raw', () => {
    paginatedReturn = paginated({ results: rows(2) }); // status: open
    renderList({
      item: { ...ITEM, badgeLabels: { open: 'Open' } },
    });

    expect(screen.getAllByText('Open')).toHaveLength(2);
    expect(screen.queryByText('open')).not.toBeInTheDocument();
  });

  it('renders the count query as a header badge', () => {
    paginatedReturn = paginated({ results: rows(1) });
    countReturn = { data: 42, isLoading: false, blocked: false };
    renderList({
      count: { path: 'conversations/queries:approxCount', args: {} },
    });
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('loads the next page on "Load more"', async () => {
    paginatedReturn = paginated({ results: rows(1), status: 'CanLoadMore' });
    renderList();
    await userEvent.click(
      screen.getByRole('button', { name: 'automations.list.loadMore' }),
    );
    expect(loadMore).toHaveBeenCalledWith(30);
  });

  it('shows the pack empty state when there are no rows', () => {
    paginatedReturn = paginated({ results: [] });
    renderList({
      emptyState: {
        titleKey: 'inbox.emptyTitle',
        descriptionKey: 'inbox.emptyDescription',
      },
    });
    expect(screen.getByText('inbox.emptyTitle')).toBeInTheDocument();
    expect(screen.getByText('inbox.emptyDescription')).toBeInTheDocument();
  });

  it('surfaces the blocked state when the path is not allowlisted', () => {
    paginatedReturn = paginated({ blocked: true });
    renderList();
    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
  });
});

describe('field-value helpers', () => {
  it('isUnreadValue reads counts and flags', () => {
    expect(isUnreadValue(2)).toBe(true);
    expect(isUnreadValue(0)).toBe(false);
    expect(isUnreadValue(true)).toBe(true);
    expect(isUnreadValue(undefined)).toBe(false);
  });

  it('readCountValue reads bare numbers and `count` records', () => {
    expect(readCountValue(7)).toBe(7);
    expect(readCountValue({ count: 3 })).toBe(3);
    expect(readCountValue({ total: 3 })).toBeUndefined();
    expect(readCountValue(undefined)).toBeUndefined();
  });
});
