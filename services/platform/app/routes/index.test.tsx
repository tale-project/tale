import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasAnyUsersQuery } from '@/app/lib/backend/account';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

/**
 * The entry route's redirect over the two reads it decides on: the session
 * (a stubbed Better Auth client behind the real session query) and the users
 * read `/setup` and `/log-in` gate on (the real query, `backendFetch` and its
 * retry policy against a closed synthetic transport). An install without any
 * account goes straight to `/setup`, so the sign-in page never renders on its
 * way there (#5012).
 */

const h = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: Record<string, unknown>) => options,
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession },
}));

import { Route } from './index';

const { beforeLoad } = Route as unknown as {
  beforeLoad: (match: {
    context: { queryClient: QueryClient };
  }) => Promise<unknown>;
};

const DOOR = /^GET \/api\/app\/users\/has-any$/;
const SIGNED_OUT = { data: null, error: null };
const SIGNED_IN = {
  data: { user: { id: 'user-1' }, session: { id: 'session-1' } },
  error: null,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue(SIGNED_OUT);
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

/** Where the route sends the visitor: the target of the redirect it throws. */
async function entryTarget(): Promise<string | undefined> {
  const thrown = await beforeLoad({ context: { queryClient: client } }).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!isRedirect(thrown)) {
    throw new Error(`Expected a redirect, got ${String(thrown)}`);
  }
  return thrown.options.to;
}

describe('the entry route', () => {
  it('sends an install without any account straight to first-run setup', async () => {
    backend.on(DOOR, () => Response.json({ hasAny: false }));

    expect(await entryTarget()).toBe('/setup');
    // Cached under the key `/setup` reads: the wizard opens without asking
    // again.
    expect(client.getQueryData(hasAnyUsersQuery().queryKey)).toBe(false);
    expect(backend.count(DOOR)).toBe(1);
  });

  it('sends a signed-out visitor to sign-in once an account exists', async () => {
    backend.on(DOOR, () => Response.json({ hasAny: true }));

    expect(await entryTarget()).toBe('/log-in');
    expect(backend.count(DOOR)).toBe(1);
  });

  it('sends a signed-in person to the dashboard without asking about accounts', async () => {
    h.getSession.mockResolvedValue(SIGNED_IN);
    backend.on(DOOR, () => Response.json({ hasAny: false }));

    expect(await entryTarget()).toBe('/dashboard');
    expect(backend.count(DOOR)).toBe(0);
  });

  it.each([
    {
      failure: 'a fault, after its retries',
      reply: serviceUnavailable,
      attempts: 4,
    },
    {
      failure: 'a refusal',
      reply: () => Response.json({ error: 'FORBIDDEN' }, { status: 403 }),
      attempts: 1,
    },
  ])(
    'falls back to sign-in when the users read fails with $failure',
    async ({ reply, attempts }) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      backend.on(DOOR, reply);

      // A read that failed knows nothing of the install, which may well have
      // accounts: never setup on a failure. `/log-in` reads it again.
      expect(await entryTarget()).toBe('/log-in');
      expect(backend.count(DOOR)).toBe(attempts);
      expect(warn).toHaveBeenCalledWith(
        'Failed to read whether any account exists:',
        expect.anything(),
      );
    },
  );
});
