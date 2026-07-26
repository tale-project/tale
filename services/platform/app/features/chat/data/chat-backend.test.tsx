// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import {
  useChatGeneration,
  useChatMessages,
  useChatThreads,
  useComposerCapabilities,
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
  const threads = useChatThreads('org-1');
  const [, force] = useState(0);
  return <button onClick={() => force((n) => n + 1)}>{threads.status}</button>;
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

describe('useChatQuery session cache', () => {
  it('serves the last answer across a remount, with a fresh watch live', () => {
    const { client, watchQuery, setLocalResult } = liveStubClient();
    setLocalResult(['thread-1']);
    const first = render(
      <ConvexProvider client={client}>
        <ThreadsProbe org="org-remount" />
      </ConvexProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ready');
    first.unmount();

    // The unmounted watch dropped its local result; without the cache the
    // remount would render a `loading` frame until the round-trip answers.
    setLocalResult(undefined);
    render(
      <ConvexProvider client={client}>
        <ThreadsProbe org="org-remount" />
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

function CapabilitiesProbe({ org }: { org: string }) {
  const capabilities = useComposerCapabilities(org);
  return (
    <output>
      {capabilities.status === 'ready'
        ? `ready:${capabilities.data.skills.length}`
        : capabilities.status}
    </output>
  );
}

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
          id: 'deepseek-chat',
          label: 'deepseek-chat',
          providerSlug: 'deepseek',
          credential: { authMethod: 'api-key' },
        },
      ],
      externalAgents: [],
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

describe('useComposerCapabilities session cache', () => {
  it('serves the cached catalog on remount and keeps it through a failed refresh', async () => {
    const catalog = {
      skills: [{ slug: 'docx', label: 'Word documents' }],
      connectors: [],
    };
    const action = vi.fn().mockResolvedValue(catalog);
    const client = { action } as unknown as ConvexReactClient;

    const first = render(
      <ConvexProvider client={client}>
        <CapabilitiesProbe org="org-caps" />
      </ConvexProvider>,
    );
    expect(await screen.findByText('ready:1')).toBeInTheDocument();
    first.unmount();

    // The remount serves the cached catalog synchronously — no loading frame
    // — and the refresh failing must not blank the working menus.
    action.mockRejectedValue(new Error('config tree unreachable'));
    render(
      <ConvexProvider client={client}>
        <CapabilitiesProbe org="org-caps" />
      </ConvexProvider>,
    );
    expect(screen.getByText('ready:1')).toBeInTheDocument();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(screen.getByText('ready:1')).toBeInTheDocument();
  });
});
