// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NodeRunPage,
  RecordedStep,
} from '@/app/lib/backend/contract/automations';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { RunStepItems } from './run-step-items';

// The list runs its real lane: `useRunItems`, `useRunNode`, the adapters,
// `backendFetch` and react-query; `fetch` answers the record's doors the
// way the backend does.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

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

beforeEach(() => {
  asked = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    const url = new URL(href, 'http://localhost');
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
      return Response.json({ page: { path: 'score', units, next: null } });
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

function renderItems() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RunStepItems organizationId={ORG} runId={RUN} step={STEP} />
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
});
