// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  useChatGeneration,
  useChatQuery,
  useChatSend,
  useChatThreads,
  useComposerModels,
} from './chat-backend';
import { storeComposerCatalog } from './composer-catalog-store';

/**
 * The one seam invariant a component can't pin: a live read holds ONE watch
 * per (function, args) pair across re-renders. `api.x.y.z` builds a fresh
 * FunctionReference on every property access and callers build args inline,
 * so a watch keyed by identity is torn down and rebuilt every render — and a
 * fresh watch answers `undefined` before its first result, which oscillates
 * the surface between loading and ready as fast as React can render. That
 * oscillation shipped as a whole-page flicker; this file keeps it dead.
 */

function stubClient(result: unknown): {
  client: ConvexReactClient;
  watchQuery: ReturnType<typeof vi.fn>;
} {
  const watchQuery = vi.fn(() => ({
    onUpdate: () => () => undefined,
    localQueryResult: () => result,
  }));
  return {
    client: { watchQuery } as unknown as ConvexReactClient,
    watchQuery,
  };
}

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
    const { client, watchQuery } = stubClient([]);
    const { user } = render(
      <ConvexProvider client={client}>
        <Probe />
      </ConvexProvider>,
    );

    expect(screen.getByRole('button')).toHaveTextContent('unavailable');

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    // Steady: the same answer on every render, never a flicker between
    // states while the component re-renders around it.
    expect(screen.getByRole('button')).toHaveTextContent('unavailable');
    expect(watchQuery).not.toHaveBeenCalled();
  });
});

/**
 * The second seam invariant: a remount must not flash `loading` for an answer
 * this session already has. A watch is torn down on unmount and the client
 * drops its local result, so a fresh mount answers `undefined` for one
 * round-trip — the session cache serves the last answer across that gap while
 * the fresh watch (still subscribed, still live) replaces it. Each test uses
 * its own org so the module-level cache can't leak between cases.
 */

/** A client whose local result can change between mounts, the way the real
 * one loses it when the last subscriber unmounts. */
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
      const { client } = stubClient(undefined);
      render(
        <ConvexProvider client={client}>
          <ThreadsProbe org="org-http" />
        </ConvexProvider>,
      );
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
      const { client } = stubClient(undefined);
      const first = render(
        <ConvexProvider client={client}>
          <CachedProbe org="org-remount" />
        </ConvexProvider>,
      );
      await screen.findByText('ready');
      first.unmount();

      // Without the cache the remount would render a `loading` frame until
      // the round-trip answers.
      render(
        <ConvexProvider client={client}>
          <CachedProbe org="org-remount" />
        </ConvexProvider>,
      );
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
      const { client } = stubClient(undefined);
      const first = render(
        <ConvexProvider client={client}>
          <WatchProbe org="org-skip" threadId="thread-1" />
        </ConvexProvider>,
      );
      first.unmount();

      // No thread selected: the read holds closed, cached answer or not.
      render(
        <ConvexProvider client={client}>
          <WatchProbe org="org-skip" />
        </ConvexProvider>,
      );
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
      const { client } = stubClient(undefined);
      const first = render(
        <ConvexProvider client={client}>
          <GenerationProbe org="org-gen" threadId="thread-1" />
        </ConvexProvider>,
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
      render(
        <ConvexProvider client={client}>
          <GenerationProbe org="org-gen" threadId="thread-1" />
        </ConvexProvider>,
      );
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

function ModelsProbe({ org }: { org: string }) {
  const catalog = useComposerModels(org);
  return (
    <output>
      {catalog.status === 'ready'
        ? `ready:${catalog.data.models.length}`
        : catalog.status}
    </output>
  );
}

describe('useComposerModels device store', () => {
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
      const { client } = stubClient(undefined);
      render(
        <ConvexProvider client={client}>
          <ModelsProbe org="org-reload" />
        </ConvexProvider>,
      );

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
    const { client } = stubClient(undefined);
    const seam = { current: null as ReturnType<typeof useChatSend> | null };
    render(
      <ConvexProvider client={client}>
        <SendProbe org="org-send" seam={seam} />
      </ConvexProvider>,
    );
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
