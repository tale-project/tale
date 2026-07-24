// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { useChatThreads } from './chat-backend';

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
