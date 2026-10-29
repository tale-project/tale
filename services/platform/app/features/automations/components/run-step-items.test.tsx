// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NodeRunPage,
  RecordedStep,
} from '@/app/lib/backend/contract/automations';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { RunStepItems } from './run-step-items';

// The list runs its real lane: `useRunItems`, `useRunNode`, the adapters,
// `backendFetch` and react-query; `fetch` answers the record's doors the
// way the backend does.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

const ORG = 'org-1';
const RUN = 'run-1';

function unit(
  item: number,
  status: NodeRunPage['units'][number]['status'],
  over: Partial<NodeRunPage['units'][number]> = {},
): NodeRunPage['units'][number] {
  return {
    path: 'score',
    nodeId: 'score',
    type: 'llm',
    status,
    item,
    pass: -1,
    activeMs: 10,
    waitedMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...over,
  };
}

const STEP: RecordedStep = {
  path: 'score',
  nodeId: 'score',
  type: 'llm',
  status: 'failed',
  activeMs: 100,
  waitedMs: 0,
  attempt: 1,
  attempts: [],
  decisions: [],
  waits: [],
  meta: {},
  counts: { items: 3, ok: 2, failed: 1, skipped: 0, kept: 3 },
};

let asked: URLSearchParams[];
/** How many units the items door answers at once; a cursor reads on. */
let perPage: number;
/** The reads the backend fails with a fault (a 500) for now. */
let fails: (url: URL) => boolean;

beforeEach(() => {
  asked = [];
  perPage = 3;
  fails = () => false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    const url = new URL(href, 'http://localhost');
    if (fails(url)) {
      return Response.json({ error: 'INTERNAL' }, { status: 500 });
    }
    if (url.pathname === `/api/app/automations/runs/${RUN}/record/items`) {
      asked.push(url.searchParams);
      const failedOnly = url.searchParams.get('status') === 'failed';
      const units = [
        unit(0, 'succeeded'),
        unit(1, 'failed', {
          failure: {
            code: 'connector_error',
            reason: 'CONNECTOR_UNREACHABLE',
            params: { connector: 'github', action: 'github.get_issue' },
            message: 'fetch failed',
          },
        }),
        unit(2, 'succeeded'),
      ].filter((each) => !failedOnly || each.status === 'failed');
      // The cursor is where the page starts.
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const end = start + perPage;
      return Response.json({
        page: {
          path: 'score',
          units: units.slice(start, end),
          next: end < units.length ? String(end) : null,
        },
      });
    }
    if (url.pathname === `/api/app/automations/runs/${RUN}/record/node`) {
      return Response.json({
        node: {
          ...unit(Number(url.searchParams.get('item')), 'failed'),
          reads: [],
          readsTotal: 0,
          output: {
            summary: { kind: 'string', text: 'second', length: 6 },
            shape: {},
            bytes: 8,
            hash: 'h',
          },
        },
      });
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderItems(props: Partial<Parameters<typeof RunStepItems>[0]> = {}) {
  return render(
    <QueryClientProvider
      client={
        // The reads keep their own retry policy, which a default here would
        // not override; no backoff between its attempts keeps a fault quick.
        new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
      }
    >
      <RunStepItems organizationId={ORG} runId={RUN} step={STEP} {...props} />
    </QueryClientProvider>,
  );
}

describe('RunStepItems', () => {
  it('lists each item with how it ended, and why one failed', async () => {
    renderItems();
    expect(screen.getByText('3 items · 1 failed')).toBeVisible();
    const list = screen.getByRole('list', {
      name: 'Items and passes of Score',
    });
    const second = await within(list).findByRole('button', { name: /Item 2/ });
    expect(second).toHaveTextContent("The service couldn't be reached");
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('passes an axe audit', async () => {
    const { container } = renderItems();
    await screen.findByRole('button', { name: /Item 2/ });
    await checkAccessibility(container);
  });

  it('shows failed items alone on request, and reads a picked one whole', async () => {
    const { user } = renderItems();
    await user.click(screen.getByRole('checkbox', { name: 'Failed only' }));
    const list = screen.getByRole('list', {
      name: 'Items and passes of Score',
    });
    const only = await within(list).findByRole('button', { name: /Item 2/ });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(asked.at(-1)?.get('status')).toBe('failed');

    await user.click(only);
    expect(only).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Returned')).toBeVisible();
    expect(screen.getByText('"second"')).toBeVisible();
  });

  it('shows the item the page chose, and tells the page about the one picked', async () => {
    const picked = vi.fn();
    renderItems({ unit: { item: 1 }, onUnitChange: picked });
    const list = screen.getByRole('list', {
      name: 'Items and passes of Score',
    });
    const second = await within(list).findByRole('button', { name: /Item 2/ });
    expect(second).toHaveAttribute('aria-pressed', 'true');
    // The chosen item is read whole below the list.
    expect(await screen.findByText(/second/)).toBeVisible();
    const third = within(list).getByRole('button', { name: /Item 3/ });
    third.click();
    expect(picked).toHaveBeenCalledWith({ item: 2 });
  });

  it('counts a repeat’s passes from 1', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({
        page: {
          path: 'score',
          units: [
            unit(-1, 'succeeded', { pass: 0 }),
            unit(-1, 'succeeded', { pass: 1 }),
          ],
          next: null,
        },
      }),
    );
    renderItems({
      step: {
        ...STEP,
        status: 'succeeded',
        counts: { items: 0, ok: 2, failed: 0, skipped: 0, passes: 2, kept: 2 },
      },
    });
    const list = screen.getByRole('list', {
      name: 'Items and passes of Score',
    });
    expect(
      await within(list).findByRole('button', { name: /Pass 1/ }),
    ).toBeVisible();
    expect(within(list).getByRole('button', { name: /Pass 2/ })).toBeVisible();
    expect(within(list).queryByRole('button', { name: /Pass 0/ })).toBeNull();
  });

  // #4745: a failed read left the list empty under its count, or dropped
  // Show more or the picked item's data, as if there were nothing more.
  describe('when a read fails', { timeout: 30_000 }, () => {
    it('says the items didn’t load, under their count, and lists them after Try again', async () => {
      fails = (url) => url.pathname.endsWith('/record/items');
      const { user, container } = renderItems();
      const list = screen.getByRole('list', {
        name: 'Items and passes of Score',
      });
      const alert = await within(list).findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load the items.");
      // The step still counts them: the read failed, not the step.
      expect(screen.getByText('3 items · 1 failed')).toBeVisible();
      await checkAccessibility(container);

      fails = () => false;
      within(alert).getByRole('button', { name: 'Try again' }).focus();
      await user.keyboard('{Enter}');
      const first = await within(list).findByRole('button', {
        name: /Item 1/,
      });
      expect(within(list).getAllByRole('button')).toHaveLength(3);
      expect(within(list).queryByRole('alert')).toBeNull();
      // Try again left with the alert while it held the focus: the first
      // item takes it, not the page.
      await waitFor(() => expect(first).toHaveFocus());
    });

    it('keeps the items shown when a later page fails, with Try again where Show more was', async () => {
      perPage = 2;
      fails = (url) => url.searchParams.has('cursor');
      const { user } = renderItems();
      const list = screen.getByRole('list', {
        name: 'Items and passes of Score',
      });
      await user.click(
        await within(list).findByRole('button', { name: 'Show more' }),
      );
      const alert = await within(list).findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load the items.");
      expect(
        within(list).getByRole('button', { name: /Item 1/ }),
      ).toBeVisible();
      expect(
        within(list).getByRole('button', { name: /Item 2/ }),
      ).toBeVisible();
      expect(
        within(list).queryByRole('button', { name: 'Show more' }),
      ).toBeNull();

      fails = () => false;
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );
      const third = await within(list).findByRole('button', {
        name: /Item 3/,
      });
      expect(asked.at(-1)?.get('cursor')).toBe('2');
      expect(within(list).getAllByRole('button')).toHaveLength(3);
      expect(within(list).queryByRole('alert')).toBeNull();
      await waitFor(() => expect(third).toHaveFocus());
    });

    it('says the picked item’s data didn’t load, in its place, and reads it after Try again', async () => {
      fails = (url) => url.pathname.endsWith('/record/node');
      const { user } = renderItems();
      const list = screen.getByRole('list', {
        name: 'Items and passes of Score',
      });
      const second = await within(list).findByRole('button', {
        name: /Item 2/,
      });
      await user.click(second);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load this item's data.");
      // The list stays as it was, with the item still picked.
      expect(second).toHaveAttribute('aria-pressed', 'true');
      expect(within(list).getAllByRole('button')).toHaveLength(3);

      fails = () => false;
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );
      expect(await screen.findByText('Returned')).toBeVisible();
      expect(screen.getByText('"second"')).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      // The item's data took the alert's place, and the focus with it.
      await waitFor(() =>
        expect(screen.getByRole('group', { name: 'Item 2' })).toHaveFocus(),
      );
    });
  });
});
