// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLayoutEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import {
  useArchivedThreads,
  useChatGeneration,
  useChatMessages,
  useChatProject,
  useChatProjectChoices,
  useChatQuery,
  useChatSend,
  useChatThreads,
  useChatThreadsRetry,
  useComposerModels,
  useEarlierChatMessages,
  useNavigatorProjects,
  useProjectPin,
} from './chat-backend';
import { storeComposerCatalog } from './composer-catalog-store';

/**
 * The one seam invariant a component can't pin: a read holds ONE query per
 * (name, args) pair across re-renders. Callers build args inline, so a query
 * keyed by object identity would be torn down and rebuilt every render — and
 * a fresh query answers `undefined` before its first result, which oscillates
 * the surface between loading and ready as fast as React can render. That
 * oscillation shipped as a whole-page flicker; this file keeps it dead.
 */

/** Re-renders on demand, passing a FRESH api reference and args each time —
 * exactly what the real callsites do. */
function Probe() {
  // A ref the seam has NOT migrated: with the Convex runtime retired there is
  // nothing behind it, so the surface must degrade — steadily, not by
  // flickering between states on every render.
  const read = useChatQuery('chat_filter_events/queries:getGuardrailStats', {
    organizationId: 'org-1',
    periodDays: 7,
  });
  const [, force] = useState(0);
  return <button onClick={() => force((n) => n + 1)}>{read.status}</button>;
}

describe('useChatQuery subscription stability', () => {
  it('holds a steady status across re-renders', async () => {
    const { user } = render(<Probe />);

    expect(screen.getByRole('button')).toHaveTextContent('unavailable');

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    // Steady: the same answer on every render, never a flicker between
    // states while the component re-renders around it.
    expect(screen.getByRole('button')).toHaveTextContent('unavailable');
  });
});

/**
 * The second seam invariant: a remount must not flash `loading` for an answer
 * this session already has. A fresh mount has no data until its fetch lands,
 * so the session cache serves the last answer across that gap while the
 * revalidation replaces it. Each test uses its own org so the module-level
 * cache can't leak between cases.
 */

function ThreadsProbe({ org }: { org: string }) {
  return <output>{useChatThreads(org).status}</output>;
}

function WatchProbe({ org, threadId }: { org: string; threadId?: string }) {
  // An ADAPTED read, skipped when no thread is selected — what the seam's
  // 'skip' contract is actually about.
  const read = useChatQuery(
    'chat/threads:listThreads',
    threadId !== undefined ? { organizationId: org } : 'skip',
  );
  return <output>{read.status}</output>;
}

function GenerationProbe({ org, threadId }: { org: string; threadId: string }) {
  return <output>{useChatGeneration(org, threadId).status}</output>;
}

describe('useChatQuery HTTP lane (migrated thread family)', () => {
  it('serves ready from the backend with a steady status and ONE fetch', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ threads: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    try {
      render(<ThreadsProbe org="org-http" />);
      await screen.findByText('ready');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const firstUrl = fetchSpy.mock.calls[0]?.[0];
      expect(typeof firstUrl === 'string' ? firstUrl : '').toContain(
        '/api/app/chat/threads',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // The seam routes only the names it lists; an unlisted one answers
  // `unavailable`, which the chat's task tray renders as nothing at all.
  it('reads the tasks a chat handed over from the backend', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ tasks: [{ id: 'task-1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    function TrayProbe() {
      const read = useChatQuery('tasks/queries:listTasksFromThread', {
        organizationId: 'org-tray',
        threadId: 'thread-1',
      });
      return (
        <output>
          {read.status === 'ready' ? `ready:${read.data.length}` : read.status}
        </output>
      );
    }
    try {
      render(<TrayProbe />);
      await screen.findByText('ready:1');
      const firstUrl = fetchSpy.mock.calls[0]?.[0];
      expect(typeof firstUrl === 'string' ? firstUrl : '').toContain(
        '/api/app/tasks/by-thread/thread-1',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // The hand-over asks where work can go. The projects read keeps only the
  // fields its projection names, so a count the backend sends and the
  // projection leaves out never reaches the dialog.
  it('reads how many of a project’s agents are the standard agent', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            isDone: true,
            projects: [
              {
                id: 'project-1',
                name: 'Website',
                projectAgentCount: 2,
                managedAgentCount: 1,
                canEdit: true,
              },
              {
                id: 'project-2',
                name: 'Handbook',
                projectAgentCount: 0,
                canEdit: false,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    function ProjectsProbe() {
      const read = useChatProjectChoices('org-projects', '');
      return (
        <output>
          {read.status === 'ready'
            ? read.data.projects
                .map(
                  (project) =>
                    `${project.name}:${project.agentCount}/${project.managedAgentCount ?? '-'}`,
                )
                .join(' ')
            : read.status}
        </output>
      );
    }
    try {
      render(<ProjectsProbe />);
      expect(
        await screen.findByText('Website:2/1 Handbook:0/-'),
      ).toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// Home's PROJECTS section reads ONE page of the projects (#5156), never the
// whole list: the sidebar read, the pinned first, and whether the page holds
// them all.
describe('useNavigatorProjects', () => {
  function sidebarResponse(pinnedAt: number | null, isDone: boolean) {
    return new Response(
      JSON.stringify({
        projects: [
          { id: 'project-2', name: 'Handbook', key: 'HB', pinnedAt: 3000 },
          { id: 'project-1', name: 'Website', pinnedAt },
        ],
        isDone,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  function NavigatorProbe({ org }: { org: string }) {
    const read = useNavigatorProjects(org);
    const pin = useProjectPin(org);
    return (
      <>
        <output>
          {read.status === 'ready'
            ? `${read.data.projects
                .map((project) => `${project.name}:${project.pinnedAt ?? '-'}`)
                .join(' ')} done=${String(read.data.isDone)}`
            : read.status}
        </output>
        <button
          type="button"
          onClick={() => void pin.setPinned('project-1', true)}
        >
          Pin Website
        </button>
      </>
    );
  }

  it('reads one page of at most 100 projects, and says when there are more', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() => Promise.resolve(sidebarResponse(null, false)));
    try {
      render(<NavigatorProbe org="org-navigator" />);
      expect(
        await screen.findByText('Handbook:3000 Website:- done=false'),
      ).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-navigator',
        expect.anything(),
      );
      expect(
        fetchSpy.mock.calls.some(
          ([url]) =>
            typeof url === 'string' && url.startsWith('/api/app/projects?'),
        ),
      ).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reads the page again after a pin, so the pinned project moves up', async () => {
    let pinned = false;
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/pin')) {
        pinned = true;
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(sidebarResponse(pinned ? 5000 : null, true));
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    try {
      const { user } = render(
        <QueryClientProvider client={client}>
          <NavigatorProbe org="org-navigator-pin" />
        </QueryClientProvider>,
      );
      await screen.findByText('Handbook:3000 Website:- done=true');

      await user.click(screen.getByRole('button', { name: 'Pin Website' }));

      await waitFor(() =>
        expect(
          screen.getByText('Handbook:3000 Website:5000 done=true'),
        ).toBeInTheDocument(),
      );
    } finally {
      fetchSpy.mockRestore();
      client.clear();
    }
  });
});

describe('useChatThreadsRetry', () => {
  // The Home stream's Try again (#4093): a list read that came back
  // `unavailable` is asked for again on the seam's own client, and the
  // reads that answered are left alone.
  it('asks again for the chat list read that failed, and for it alone', async () => {
    let status = 503;
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              status === 200 ? { threads: [] } : { error: 'Unavailable' },
            ),
            { status, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function RetryProbe() {
      const threads = useChatThreads('org-retry');
      const retry = useChatThreadsRetry('org-retry');
      return (
        <button
          type="button"
          onClick={() => void retry({ threads: true, archived: false })}
        >
          {threads.status}
        </button>
      );
    }
    try {
      const { user } = render(
        <QueryClientProvider client={client}>
          <RetryProbe />
        </QueryClientProvider>,
      );
      await screen.findByText('unavailable');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      status = 200;
      await user.click(screen.getByRole('button'));
      await screen.findByText('ready');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const urls = fetchSpy.mock.calls.map(([input]) =>
        typeof input === 'string' ? input : '',
      );
      expect(urls.every((url) => url.includes('/api/app/chat/threads'))).toBe(
        true,
      );
      expect(urls.some((url) => url.includes('/archived'))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('asks again for the first archived page alone when that read failed', async () => {
    let archivedStatus = 503;
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const archived =
        typeof input === 'string' && input.includes('/chat/threads/archived');
      const status = archived ? archivedStatus : 200;
      const body = !archived
        ? { threads: [] }
        : status === 200
          ? { rows: [], nextCursor: null }
          : { error: 'Unavailable' };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function ArchivedProbe() {
      const threads = useChatThreads('org-retry-archived');
      const archived = useArchivedThreads('org-retry-archived', {
        enabled: true,
      });
      const retry = useChatThreadsRetry('org-retry-archived');
      return (
        <button
          type="button"
          onClick={() => void retry({ threads: false, archived: true })}
        >
          {`${threads.status}/${archived.status}`}
        </button>
      );
    }
    try {
      const { user } = render(
        <QueryClientProvider client={client}>
          <ArchivedProbe />
        </QueryClientProvider>,
      );
      await screen.findByText('ready/unavailable');
      const asked = fetchSpy.mock.calls.length;

      archivedStatus = 200;
      await user.click(screen.getByRole('button'));
      await screen.findByText('ready/ready');
      const urls = fetchSpy.mock.calls
        .slice(asked)
        .map(([input]) => (typeof input === 'string' ? input : ''));
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('/api/app/chat/threads/archived');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('useChatQuery session cache', () => {
  /** An ADAPTED read (the threads listing) whose answer the seam caches. */
  function CachedProbe({ org }: { org: string }) {
    return <output>{useChatThreads(org).status}</output>;
  }

  it('serves the last answer across a remount while it revalidates', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ threads: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    try {
      const first = render(<CachedProbe org="org-remount" />);
      await screen.findByText('ready');
      first.unmount();

      // Without the cache the remount would render a `loading` frame until
      // the round-trip answers.
      render(<CachedProbe org="org-remount" />);
      expect(screen.getByRole('status')).toHaveTextContent('ready');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('never serves the cache to a skipped read', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ stats: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    try {
      const first = render(<WatchProbe org="org-skip" threadId="thread-1" />);
      first.unmount();

      // No thread selected: the read holds closed, cached answer or not.
      render(<WatchProbe org="org-skip" />);
      expect(screen.getByRole('status')).toHaveTextContent('loading');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('never replays a generation — a fresh stream resolves anew', async () => {
    // The generation rides the thread's SSE lane now: a mount opens its own
    // EventSource and holds `loading` until the lane's first event.
    const sources: FakeEventSource[] = [];
    class FakeEventSource {
      listeners = new Map<string, (event: MessageEvent<string>) => void>();
      constructor() {
        sources.push(this);
      }
      addEventListener(
        name: string,
        listener: (event: MessageEvent<string>) => void,
      ) {
        this.listeners.set(name, listener);
      }
      emit(name: string, data: string) {
        this.listeners.get(name)?.(new MessageEvent(name, { data }));
      }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    try {
      const first = render(
        <GenerationProbe org="org-gen" threadId="thread-1" />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('loading');
      const { act } = await import('react');
      act(() => {
        sources[0]?.emit(
          'progress',
          JSON.stringify({ messageId: 'm-1', text: 'hi' }),
        );
      });
      expect(screen.getByRole('status')).toHaveTextContent('ready');
      first.unmount();

      // A remount opens a FRESH stream: nothing replays until it answers.
      render(<GenerationProbe org="org-gen" threadId="thread-1" />);
      expect(sources.length).toBe(2);
      expect(screen.getByRole('status')).toHaveTextContent('loading');
      act(() => {
        sources[1]?.emit('idle', '');
      });
      expect(screen.getByRole('status')).toHaveTextContent('ready');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function ModelsProbe({
  org,
  requireFresh,
}: {
  org: string;
  requireFresh?: boolean;
}) {
  const catalog = useComposerModels(org, { requireFresh });
  return (
    <output>
      {catalog.status === 'ready'
        ? `ready:${catalog.data.models.length}`
        : catalog.status}
    </output>
  );
}

describe('useComposerModels', () => {
  it('shares one request between every mount that asks for the same org', () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    try {
      // The chat surface's picker and the voice capabilities both read the
      // catalog on one page; each mount used to fetch it again.
      render(
        <>
          <ModelsProbe org="org-shared" />
          <ModelsProbe org="org-shared" />
        </>,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0]?.[0];
      expect(typeof url === 'string' ? url : '').toContain(
        '/api/app/chat/composer/models',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('useComposerModels device store', () => {
  it('leaves audio capability unknown while refreshing a stored unavailable answer', () => {
    storeComposerCatalog('org-audio-refresh', {
      models: [],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    });
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    try {
      render(<ModelsProbe org="org-audio-refresh" requireFresh />);
      expect(screen.getByRole('status')).toHaveTextContent('loading');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it('starts ready from the stored catalog on a fresh session', () => {
    // A previous SESSION persisted this org's catalog; the in-memory session
    // cache knows nothing about it (fresh org key), the way a reload starts.
    storeComposerCatalog('org-reload', {
      models: [
        {
          id: 'deepseek-v4-flash',
          label: 'deepseek-v4-flash',
          providerSlug: 'deepseek',
          credential: { authMethod: 'api-key' },
        },
      ],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    });
    // The HTTP refresh never answers in this test — first paint must not
    // depend on it.
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    try {
      render(<ModelsProbe org="org-reload" />);

      expect(screen.getByRole('status')).toHaveTextContent('ready:1');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const refreshUrl = fetchSpy.mock.calls[0]?.[0];
      expect(typeof refreshUrl === 'string' ? refreshUrl : '').toContain(
        '/api/app/chat/composer/models',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/** Captures the seam's write handle so the tests can drive it directly. */
function SendProbe({
  org,
  seam,
}: {
  org: string;
  seam: { current: ReturnType<typeof useChatSend> | null };
}) {
  seam.current = useChatSend(org);
  return null;
}

/**
 * The write seam. A chat turn is model-only (the Chat·Task·Automation
 * boundary): a fresh thread is created as kind `direct`, the turn action
 * carries no agent and never a sandbox, and Stop is a MUTATION on the
 * generation row — the turn reads the flag on its next streaming write.
 */
describe('useChatSend', () => {
  function renderSendProbe() {
    const seam = { current: null as ReturnType<typeof useChatSend> | null };
    render(<SendProbe org="org-send" seam={seam} />);
    return seam;
  }

  /** One JSON hop of the send choreography, keyed by url suffix. */
  function mockBackend(answers: Record<string, unknown>) {
    return vi
      .spyOn(window, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const hit = Object.entries(answers).find(([suffix]) =>
          url.split('?')[0]?.endsWith(suffix),
        );
        return Promise.resolve(
          new Response(JSON.stringify(hit?.[1] ?? {}), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      });
  }

  function callsTo(
    fetchSpy: ReturnType<typeof mockBackend>,
    suffix: string,
  ): { url: string; body: unknown }[] {
    return fetchSpy.mock.calls
      .filter(([input]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return url.split('?')[0]?.endsWith(suffix) ?? false;
      })
      .map(([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const raw = init?.body;
        return {
          url,
          body:
            typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
        };
      });
  }

  it("starts a fresh turn on a thread it creates as kind 'direct', with no agent", async () => {
    const fetchSpy = mockBackend({
      '/chat/threads': { id: 't-new' },
      '/messages': { status: 'completed' },
    });
    try {
      const seam = renderSendProbe();
      const handle = await seam.current?.start({
        text: 'hello',
        modelId: 'deepseek-v4-flash',
      });
      expect(handle?.threadId).toBe('t-new');
      await handle?.outcome;

      const creates = callsTo(fetchSpy, '/chat/threads');
      expect(creates[0]?.url).toContain('orgId=org-send');
      expect(creates[0]?.body).toEqual({ kind: 'direct' });
      // Exactly these fields: no agentSlug, no harness, no sandbox knob —
      // the route owns the sandbox-off posture server-side.
      const sends = callsTo(fetchSpy, '/messages');
      expect(sends[0]?.url).toContain('/chat/threads/t-new/messages');
      expect(sends[0]?.body).toEqual({
        text: 'hello',
        modelId: 'deepseek-v4-flash',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('pins the effort pick on the thread it creates, not only on the turn', async () => {
    const fetchSpy = mockBackend({
      '/chat/threads': { id: 't-new' },
      '/messages': { status: 'completed' },
    });
    try {
      const seam = renderSendProbe();
      const handle = await seam.current?.start({
        text: 'hello',
        modelId: 'deepseek-v4-flash',
        reasoningEffort: 'low',
      });
      await handle?.outcome;

      expect(callsTo(fetchSpy, '/chat/threads')[0]?.body).toEqual({
        kind: 'direct',
        reasoningEffort: 'low',
      });
      expect(callsTo(fetchSpy, '/messages')[0]?.body).toEqual({
        text: 'hello',
        modelId: 'deepseek-v4-flash',
        reasoningEffort: 'low',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('pins the effort pick when parking a send on a new thread', async () => {
    const fetchSpy = mockBackend({
      '/chat/threads': { id: 't-new' },
      '/deferred-sends': { deferredSendId: 'd-1' },
    });
    try {
      const seam = renderSendProbe();
      await seam.current?.defer({
        text: 'hello',
        reasoningEffort: 'low',
      });

      expect(callsTo(fetchSpy, '/chat/threads')[0]?.body).toEqual({
        kind: 'direct',
        reasoningEffort: 'low',
      });
      const parked = callsTo(fetchSpy, '/deferred-sends');
      expect(parked[0]?.url).toContain('/chat/threads/t-new/deferred-sends');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('continues an existing thread without creating another', async () => {
    const fetchSpy = mockBackend({
      '/messages': { status: 'completed' },
    });
    try {
      const seam = renderSendProbe();
      const handle = await seam.current?.start({
        threadId: 't-9',
        text: 'again',
        modelId: 'deepseek-v4-flash',
        providerSlug: 'deepseek',
        reasoningEffort: 'high',
      });
      expect(handle?.threadId).toBe('t-9');
      await handle?.outcome;

      expect(callsTo(fetchSpy, '/chat/threads')).toHaveLength(0);
      expect(callsTo(fetchSpy, '/messages')[0]?.body).toEqual({
        text: 'again',
        modelId: 'deepseek-v4-flash',
        providerSlug: 'deepseek',
        reasoningEffort: 'high',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('carries the UI language on the send — the turn quotes the interface in it', async () => {
    const fetchSpy = mockBackend({
      '/messages': { status: 'completed' },
    });
    try {
      const seam = renderSendProbe();
      const handle = await seam.current?.start({
        threadId: 't-9',
        text: 'Erstell mir das als Word-Datei',
        modelSelection: 'auto',
        locale: 'de-CH',
      });
      await handle?.outcome;

      expect(callsTo(fetchSpy, '/messages')[0]?.body).toEqual({
        text: 'Erstell mir das als Word-Datei',
        modelSelection: 'auto',
        locale: 'de-CH',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('stops a turn through the cancel door on the thread', async () => {
    const fetchSpy = mockBackend({ '/cancel': { cancelled: true } });
    try {
      const seam = renderSendProbe();
      await seam.current?.stop('thread-1');

      const cancels = callsTo(fetchSpy, '/cancel');
      expect(cancels).toHaveLength(1);
      expect(cancels[0]?.url).toContain('/chat/threads/thread-1/cancel');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * The transcript's way back reads one older page on request. What holds the
 * reader's place lets go when loading ends, so loading ends in the frame
 * that shows the older rows — a frame between them would drop the place.
 */
describe('useEarlierChatMessages', () => {
  const row = (id: string, sequence: number) => ({
    id,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', text: id }],
    sequence,
    createdAt: sequence,
  });
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const urlOf = (input: RequestInfo | URL) =>
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const newest = {
    thread: {},
    messages: [row('m3', 3), row('m4', 4)],
    hasMore: true,
    nextBefore: { order: 3, stepOrder: 0 },
  };

  /** The way back in a component of its own, logging each frame it commits:
   * the rows shown, and whether it reads as loading. */
  function WayBack({
    org,
    thread,
    shown,
    frames,
  }: {
    org: string;
    thread: string;
    shown: number;
    frames: string[];
  }) {
    const { hasMore, loading, loadEarlier } = useEarlierChatMessages(
      org,
      thread,
    );
    const [failed, setFailed] = useState(false);
    useLayoutEffect(() => {
      frames.push(`${shown}${loading ? ' loading' : ''}`);
    });
    return (
      <>
        <output>
          {`${shown} rows${hasMore ? ', more' : ''}${failed ? ', failed' : ''}`}
        </output>
        <button
          type="button"
          onClick={() => {
            loadEarlier().catch(() => setFailed(true));
          }}
        >
          Earlier
        </button>
      </>
    );
  }

  /** The rows, read where the transcript reads them. */
  function EarlierProbe({
    org,
    thread = 't1',
    frames,
  }: {
    org: string;
    thread?: string;
    frames: string[];
  }) {
    const rows = useChatMessages(org, thread);
    return (
      <WayBack
        org={org}
        thread={thread}
        shown={rows.status === 'ready' ? rows.data.length : 0}
        frames={frames}
      />
    );
  }

  it('reads as loading until the frame that shows the older rows', async () => {
    let answerOlder: (response: Response) => void = () => {};
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((input) =>
      urlOf(input).includes('beforeOrder=3')
        ? new Promise<Response>((resolve) => {
            answerOlder = resolve;
          })
        : Promise.resolve(answer(newest)),
    );
    const frames: string[] = [];
    try {
      const { user } = render(
        <QueryClientProvider client={new QueryClient()}>
          <EarlierProbe org="org-earlier" frames={frames} />
        </QueryClientProvider>,
      );
      await screen.findByText('2 rows, more');
      await user.click(screen.getByRole('button', { name: 'Earlier' }));
      expect(frames.at(-1)).toBe('2 loading');

      answerOlder(
        answer({
          thread: {},
          messages: [row('m1', 1), row('m2', 2)],
          hasMore: false,
          nextBefore: null,
        }),
      );
      await screen.findByText('4 rows');

      // No frame between: the way back's own state never ends loading ahead
      // of the rows another component reads.
      const since = frames.indexOf('2 loading');
      expect([...new Set(frames.slice(since))]).toEqual(['2 loading', '4']);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('stops loading when the read fails, and keeps the rows it had', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation((input) =>
        Promise.resolve(
          urlOf(input).includes('beforeOrder=3')
            ? answer({ error: 'internal' }, 500)
            : answer(newest),
        ),
      );
    const frames: string[] = [];
    try {
      const { user } = render(
        <QueryClientProvider client={new QueryClient()}>
          <EarlierProbe org="org-earlier-failed" frames={frames} />
        </QueryClientProvider>,
      );
      await screen.findByText('2 rows, more');
      await user.click(screen.getByRole('button', { name: 'Earlier' }));

      await screen.findByText('2 rows, more, failed');
      expect(frames).toContain('2 loading');
      expect(frames.at(-1)).toBe('2');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps a pending read to the thread it reads', async () => {
    let answerOlder: (response: Response) => void = () => {};
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((input) =>
      urlOf(input).includes('/t1/messages?beforeOrder=3')
        ? new Promise<Response>((resolve) => {
            answerOlder = resolve;
          })
        : Promise.resolve(answer(newest)),
    );
    const frames: string[] = [];
    const client = new QueryClient();
    const open = (thread: string) => (
      <QueryClientProvider client={client}>
        <EarlierProbe
          org="org-earlier-threads"
          thread={thread}
          frames={frames}
        />
      </QueryClientProvider>
    );
    try {
      const { user, rerender } = render(open('t1'));
      await screen.findByText('2 rows, more');
      await user.click(screen.getByRole('button', { name: 'Earlier' }));
      expect(frames.at(-1)).toBe('2 loading');

      // Another thread whose rows begin at the same place is not reading.
      rerender(open('t2'));
      await waitFor(() => expect(frames.at(-1)).toBe('2'));

      // Back in the first, its read still runs, and lands.
      rerender(open('t1'));
      expect(frames.at(-1)).toBe('2 loading');
      answerOlder(
        answer({
          thread: {},
          messages: [row('m1', 1), row('m2', 2)],
          hasMore: false,
          nextBefore: null,
        }),
      );
      await screen.findByText('4 rows');
      expect(frames.at(-1)).toBe('4');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// A picker offers the navigator's page and, past it, what the server finds
// by name (#5194): never the whole list.
describe('useChatProjectChoices', () => {
  const page = Array.from({ length: 100 }, (_, index) => ({
    id: `p-${index + 1}`,
    name: `Project ${index + 1}`,
  }));

  function ChoicesProbe({ org, query }: { org: string; query: string }) {
    const read = useChatProjectChoices(org, query);
    return (
      <output>
        {read.status === 'ready'
          ? `${read.data.projects.length} [${read.data.projects
              .slice(100)
              .map((project) => `${project.name}:${String(project.canEdit)}`)
              .join(' ')}] done=${String(read.data.isDone)}`
          : read.status}
      </output>
    );
  }

  it('adds what the server finds past the page, archived projects dropped', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((url) =>
      Promise.resolve(
        typeof url === 'string' && url.includes('/projects/search?')
          ? jsonResponse({
              projects: [
                { id: 'p-10', name: 'Project 10' },
                { id: 'p-101', name: 'Project 101', canEdit: true },
                { id: 'p-1010', name: 'Project 1010', archivedAt: 5 },
              ],
            })
          : jsonResponse({ projects: page, isDone: false }),
      ),
    );
    try {
      const { rerender } = render(<ChoicesProbe org="org-choices" query="" />);
      expect(await screen.findByText('100 [] done=false')).toBeInTheDocument();

      rerender(<ChoicesProbe org="org-choices" query=" Project 10 " />);

      expect(
        await screen.findByText('101 [Project 101:true] done=false'),
      ).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/app/projects/search?q=Project%2010&summary=true&orgId=org-choices',
        expect.anything(),
      );
      expect(
        fetchSpy.mock.calls.some(
          ([url]) =>
            typeof url === 'string' && url.startsWith('/api/app/projects?'),
        ),
      ).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('asks the server nothing when the page holds every project', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ projects: page.slice(0, 3), isDone: true }),
        ),
      );
    try {
      render(<ChoicesProbe org="org-choices-done" query="Project 2" />);
      expect(await screen.findByText('3 [] done=true')).toBeInTheDocument();
      // Past the debounce: still no search.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(
        fetchSpy.mock.calls.some(
          ([url]) => typeof url === 'string' && url.includes('/search?'),
        ),
      ).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// The selected project resolves by id wherever the page lacks it (#5194).
describe('useChatProject', () => {
  function ProjectProbe({ org, id }: { org: string; id: string | undefined }) {
    const read = useChatProject(org, id);
    return (
      <output>
        {read.status === 'ready'
          ? read.data === null
            ? 'none'
            : `${read.data.name}:${String(read.data.canEdit)}`
          : read.status}
      </output>
    );
  }

  it('reads a project by id; an archived, gone or absent one is null', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((url) => {
      const path = typeof url === 'string' ? url : '';
      if (path.startsWith('/api/app/projects/p-101?'))
        return Promise.resolve(
          jsonResponse({
            project: { id: 'p-101', name: 'Project 101', canEdit: true },
          }),
        );
      if (path.startsWith('/api/app/projects/p-archived?'))
        return Promise.resolve(
          jsonResponse({
            project: { id: 'p-archived', name: 'Old', archivedAt: 5 },
          }),
        );
      return Promise.resolve(jsonResponse({ error: 'PROJECT_NOT_FOUND' }, 404));
    });
    try {
      const { rerender, unmount } = render(
        <ProjectProbe org="org-by-id" id="p-101" />,
      );
      expect(await screen.findByText('Project 101:true')).toBeInTheDocument();

      rerender(<ProjectProbe org="org-by-id" id="p-archived" />);
      // Another project's answer never stands in while this one loads.
      expect(screen.queryByText('Project 101:true')).not.toBeInTheDocument();
      expect(await screen.findByText('none')).toBeInTheDocument();
      unmount();

      render(<ProjectProbe org="org-by-id" id="p-gone" />);
      expect(await screen.findByText('none')).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/app/projects/p-gone?orgId=org-by-id',
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reads nothing for no id', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    try {
      render(<ProjectProbe org="org-by-id-none" id={undefined} />);
      expect(screen.getByText('none')).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
