// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  useChatGeneration,
  useChatMessages,
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
  // Messages still ride the websocket watch (the thread LIST moved to the
  // HTTP lane in the shell migration — its stability twin is below).
  const messages = useChatMessages('org-1', 'thread-1');
  const [, force] = useState(0);
  return <button onClick={() => force((n) => n + 1)}>{messages.status}</button>;
}

describe('useChatQuery subscription stability', () => {
  it('keeps one watch and a steady status across re-renders', async () => {
    const { client, watchQuery } = stubClient([]);
    const { user } = render(
      <ConvexProvider client={client}>
        <Probe />
      </ConvexProvider>,
    );

    expect(screen.getByRole('button')).toHaveTextContent('ready');

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('ready');
    expect(watchQuery).toHaveBeenCalledTimes(1);
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
function liveStubClient(): {
  client: ConvexReactClient;
  watchQuery: ReturnType<typeof vi.fn>;
  setLocalResult: (result: unknown) => void;
} {
  let live: unknown;
  const watchQuery = vi.fn(() => ({
    onUpdate: () => () => undefined,
    localQueryResult: () => live,
  }));
  return {
    client: { watchQuery } as unknown as ConvexReactClient,
    watchQuery,
    setLocalResult: (result: unknown) => {
      live = result;
    },
  };
}

function ThreadsProbe({ org }: { org: string }) {
  return <output>{useChatThreads(org).status}</output>;
}

function MessagesProbe({ org, threadId }: { org: string; threadId?: string }) {
  return <output>{useChatMessages(org, threadId).status}</output>;
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
  it('serves the last answer across a remount, with a fresh watch live', () => {
    const { client, watchQuery, setLocalResult } = liveStubClient();
    setLocalResult(['message-1']);
    const first = render(
      <ConvexProvider client={client}>
        <MessagesProbe org="org-remount" threadId="thread-1" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ready');
    first.unmount();

    // The unmounted watch dropped its local result; without the cache the
    // remount would render a `loading` frame until the round-trip answers.
    setLocalResult(undefined);
    render(
      <ConvexProvider client={client}>
        <MessagesProbe org="org-remount" threadId="thread-1" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ready');
    // Served from cache, but revalidating: the remount opened its own watch.
    expect(watchQuery).toHaveBeenCalledTimes(2);
  });

  it('never serves the cache to a skipped read', () => {
    const { client, setLocalResult } = liveStubClient();
    setLocalResult(['message-1']);
    const first = render(
      <ConvexProvider client={client}>
        <MessagesProbe org="org-skip" threadId="thread-1" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ready');
    first.unmount();

    // No thread selected: the read holds closed, cached messages or not.
    render(
      <ConvexProvider client={client}>
        <MessagesProbe org="org-skip" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('loading');
  });

  it('never replays a generation — its absence is the settled signal', () => {
    const { client, setLocalResult } = liveStubClient();
    setLocalResult({ generationId: 'gen-1' });
    const first = render(
      <ConvexProvider client={client}>
        <GenerationProbe org="org-gen" threadId="thread-1" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ready');
    first.unmount();

    setLocalResult(undefined);
    render(
      <ConvexProvider client={client}>
        <GenerationProbe org="org-gen" threadId="thread-1" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('loading');
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
    // The refresh action never answers in this test — first paint must not
    // depend on it.
    const action = vi.fn(() => new Promise(() => {}));
    const client = { action } as unknown as ConvexReactClient;

    render(
      <ConvexProvider client={client}>
        <ModelsProbe org="org-reload" />
      </ConvexProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('ready:1');
    expect(action).toHaveBeenCalledTimes(1);
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
  function renderSendProbe(client: ConvexReactClient) {
    const seam = { current: null as ReturnType<typeof useChatSend> | null };
    render(
      <ConvexProvider client={client}>
        <SendProbe org="org-send" seam={seam} />
      </ConvexProvider>,
    );
    return seam;
  }

  it("starts a fresh turn on a thread it creates as kind 'direct', with no agent", async () => {
    const mutation = vi.fn().mockResolvedValue('t-new');
    const action = vi.fn().mockResolvedValue({ status: 'completed' });
    const client = { mutation, action } as unknown as ConvexReactClient;
    const seam = renderSendProbe(client);

    const handle = await seam.current?.start({
      text: 'hello',
      modelId: 'deepseek-v4-flash',
    });

    expect(handle?.threadId).toBe('t-new');
    const [createRef, createArgs] = mutation.mock.calls[0];
    expect(getFunctionName(createRef)).toBe('chat/threads:createThread');
    expect(createArgs).toEqual({ organizationId: 'org-send', kind: 'direct' });
    // Exactly these fields: no agentSlug, no harness — the only sandbox
    // mention is the explicit `false`.
    const [turnRef, turnArgs] = action.mock.calls[0];
    expect(getFunctionName(turnRef)).toBe('chat/turn_action:startTurn');
    expect(turnArgs).toEqual({
      organizationId: 'org-send',
      threadId: 't-new',
      userText: 'hello',
      modelId: 'deepseek-v4-flash',
      sandbox: false,
    });
  });

  it('pins the effort pick on the thread it creates, not only on the turn', async () => {
    const mutation = vi.fn().mockResolvedValue('t-new');
    const action = vi.fn().mockResolvedValue({ status: 'completed' });
    const client = { mutation, action } as unknown as ConvexReactClient;
    const seam = renderSendProbe(client);

    await seam.current?.start({
      text: 'hello',
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'low',
    });

    const [, createArgs] = mutation.mock.calls[0];
    expect(createArgs).toEqual({
      organizationId: 'org-send',
      kind: 'direct',
      reasoningEffort: 'low',
    });
    const [, turnArgs] = action.mock.calls[0];
    expect(turnArgs).toEqual({
      organizationId: 'org-send',
      threadId: 't-new',
      userText: 'hello',
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'low',
      sandbox: false,
    });
  });

  it('pins the effort pick when parking a send on a new thread', async () => {
    const mutation = vi.fn().mockResolvedValue('t-new');
    const client = { mutation } as unknown as ConvexReactClient;
    const seam = renderSendProbe(client);

    await seam.current?.defer({
      text: 'hello',
      reasoningEffort: 'low',
    });

    const [createRef, createArgs] = mutation.mock.calls[0];
    expect(getFunctionName(createRef)).toBe('chat/threads:createThread');
    expect(createArgs).toEqual({
      organizationId: 'org-send',
      kind: 'direct',
      reasoningEffort: 'low',
    });
  });

  it('continues an existing thread without creating another', async () => {
    const mutation = vi.fn();
    const action = vi.fn().mockResolvedValue({ status: 'completed' });
    const client = { mutation, action } as unknown as ConvexReactClient;
    const seam = renderSendProbe(client);

    const handle = await seam.current?.start({
      threadId: 't-9',
      text: 'again',
      modelId: 'deepseek-v4-flash',
      providerSlug: 'deepseek',
      reasoningEffort: 'high',
    });

    expect(handle?.threadId).toBe('t-9');
    expect(mutation).not.toHaveBeenCalled();
    const [, turnArgs] = action.mock.calls[0];
    expect(turnArgs).toEqual({
      organizationId: 'org-send',
      threadId: 't-9',
      userText: 'again',
      modelId: 'deepseek-v4-flash',
      providerSlug: 'deepseek',
      reasoningEffort: 'high',
      sandbox: false,
    });
  });

  it('stops a turn through the cancel-request mutation on the generation row', async () => {
    const mutation = vi.fn().mockResolvedValue(null);
    const client = { mutation } as unknown as ConvexReactClient;
    const seam = renderSendProbe(client);

    await seam.current?.stop('thread-1');

    expect(mutation).toHaveBeenCalledTimes(1);
    const [cancelRef, cancelArgs] = mutation.mock.calls[0];
    expect(getFunctionName(cancelRef)).toBe(
      'chat/generations:requestCancelGeneration',
    );
    expect(cancelArgs).toEqual({
      organizationId: 'org-send',
      threadId: 'thread-1',
    });
  });
});
