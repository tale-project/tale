// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { RunActions, type RunActionsProps } from './run-actions';

// The actions run their real lane: `useReplayRun`, the adapter,
// `backendFetch` and react-query. Only the session probe and the network
// are synthetic: `fetch` answers the run's replay door the way the backend
// does.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

const ORG = 'org-1';
const RUN = 'run-1';

let posts: unknown[];

beforeEach(() => {
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    const url = new URL(href, 'http://localhost');
    if (
      init?.method === 'POST' &&
      url.pathname === `/api/app/automations/runs/${RUN}/replay`
    ) {
      posts.push(typeof init.body === 'string' ? JSON.parse(init.body) : null);
      return Response.json(
        { runId: 'run-2', version: 3, mode: 'mock', kind: 'again', reused: 0 },
        { status: 201 },
      );
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderActions(props: Partial<RunActionsProps> = {}) {
  const client = new QueryClient();
  const onStarted = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <RunActions
        organizationId={ORG}
        automationSlug="triage"
        run={{ id: RUN, version: 3, mode: 'mock', input: { repo: 'app' } }}
        latestVersion={3}
        deployedVersion={3}
        canStartLive
        writes={{ count: 0, connectors: [] }}
        href={`/dashboard/${ORG}/automations/triage/runs/${RUN}`}
        onStarted={onStarted}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onStarted };
}

describe('RunActions — Run again', () => {
  it('runs a test run again as it ran, at once', async () => {
    const { user, onStarted } = renderActions();

    await user.click(screen.getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(posts).toEqual([
      expect.objectContaining({ kind: 'again', version: 'same', mode: 'mock' }),
    ]);
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-2' }),
    );
  });

  it('asks before a live run sends its writes again', async () => {
    const { user, onStarted } = renderActions({
      run: { id: RUN, version: 3, mode: 'live', input: { repo: 'app' } },
      writes: { count: 2, connectors: ['GitHub'] },
    });

    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(
      await screen.findByText(
        'This sends 2 writes to GitHub again, as the last run did.',
      ),
    ).toBeVisible();
    expect(posts).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Run again live' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(posts).toEqual([
      expect.objectContaining({ kind: 'again', version: 'same', mode: 'live' }),
    ]);
  });

  it('says why a live run cannot run again live, and offers the ways it can', async () => {
    const { user } = renderActions({
      run: { id: RUN, version: 3, mode: 'live', input: { repo: 'app' } },
      latestVersion: 6,
      deployedVersion: 5,
    });

    const again = screen.getByRole('button', { name: 'Run again' });
    expect(again).toHaveAttribute('aria-disabled', 'true');
    await user.click(again);
    expect(posts).toEqual([]);

    await user.click(
      screen.getByRole('button', { name: 'More ways to run again' }),
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Run live on v5' }),
    ).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: 'Run again as a test' }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('menuitem', { name: 'Run again on v6 as a test' }),
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ version: 'latest', mode: 'mock' });
  });

  it('does not run a live run again live for a role that may not start live runs', () => {
    renderActions({
      run: { id: RUN, version: 3, mode: 'live', input: { repo: 'app' } },
      canStartLive: false,
    });

    expect(screen.getByRole('button', { name: 'Run again' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('RunActions — Edit input and run', () => {
  const inputSchema = {
    type: 'object',
    properties: { repo: { type: 'string' } },
  };

  it('runs the run with the input the reader changed', async () => {
    const { user, onStarted } = renderActions({ inputSchema });

    await user.click(
      screen.getByRole('button', { name: 'More ways to run again' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit input and run…' }),
    );
    const box = await screen.findByRole('textbox', {
      name: 'Run input (JSON)',
    });
    expect(box).toHaveValue(JSON.stringify({ repo: 'app' }, null, 2));
    await user.clear(box);
    await user.click(box);
    await user.paste('{"repo":"web"}');
    await user.click(screen.getByRole('button', { name: 'Test run' }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(posts).toEqual([
      expect.objectContaining({
        kind: 'edited',
        version: 'same',
        mode: 'mock',
        input: { repo: 'web' },
      }),
    ]);
  });

  it('runs the run again when the input did not change', async () => {
    const { user } = renderActions({ inputSchema });

    await user.click(
      screen.getByRole('button', { name: 'More ways to run again' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit input and run…' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Test run' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ kind: 'again' });
    expect(posts[0]).not.toHaveProperty('input');
  });
});
