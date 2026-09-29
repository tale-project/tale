import { AppShell } from '@tale/ui/app-shell';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCreateCredential as useCreateProviderCredential,
  useDeleteCredential as useDeleteProviderCredential,
  useUpdateCredential as useUpdateProviderCredential,
} from '@/app/features/settings/providers/hooks/mutations';
import { useProviderCredentials } from '@/app/features/settings/providers/hooks/queries';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useBackendHints } from '@/app/lib/backend/use-backend-hints';
import { i18n } from '@/lib/i18n/i18n';
import { CONNECTOR_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

import {
  useCreateCredential,
  useDeleteCredential,
  useSetDefaultCredential,
  useUpdateCredential,
} from './mutations';
import { useConnectorCredentials } from './queries';

/**
 * #3712 and #3714 at the seam the pages use: real hooks, real adapter rows
 * and a real query client; only `fetch` is stubbed, answering like the
 * backend, and the hint stream is a controllable stand-in.
 *
 * - Another session's credential write reaches the open connectors page,
 *   and the mailbox reads that share its listing, as a hint.
 * - A write refused because its credential is gone — a hint this tab
 *   missed — refetches the listing, so the ghost row drops instead of
 *   failing the same way on every click. Other refusals leave it alone.
 * - A refused create or edit raises no generic "Try again" toast: the
 *   dialog shows the server's sentence inline, once.
 */

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn() };
});

const ORG = 'org-connectors';
const CONNECTOR_LIST = '/api/app/connector-credentials';
const PROVIDER_LIST = '/api/app/provider-credentials';

/** The GET paths the stubbed backend answered, in order. */
let gets: string[] = [];
/** What a write to a credential id answers: a refusal, or success. */
let writeAnswer: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true },
};

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function backend(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  );
  const path = url.pathname;
  if ((init?.method ?? 'GET') !== 'GET') {
    return json(writeAnswer.body, writeAnswer.status);
  }
  gets.push(path);
  if (path === CONNECTOR_LIST) return json({ credentials: [] });
  if (path === PROVIDER_LIST) return json({ credentials: [] });
  // The session probe and anything else this file does not exercise.
  return json({ error: 'UNAUTHORIZED' }, 401);
}

const fetchesOf = (path: string) =>
  gets.filter((entry) => entry === path).length;

const refusal = (code: string, message: string, status: number) => ({
  status,
  body: { error: code, message },
});

/** A controllable hint stream: the test dispatches the backend's events. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  readyState = 1;
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent<string>) => void>
  >();

  constructor() {
    FakeEventSource.last = this;
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent<string>(type, { data }));
    }
  }
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppShell>
  );
}

/** Every destructive toast raised so far. */
const failureToasts = () =>
  vi
    .mocked(toast)
    .mock.calls.map(([shown]) => shown)
    .filter((shown) => shown.variant === 'destructive');

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  gets = [];
  writeAnswer = { status: 200, body: { ok: true } };
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input, init) =>
    Promise.resolve(backend(input, init)),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  queryClient.clear();
  vi.mocked(toast).mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__ENV__;
  FakeEventSource.last = undefined;
});

describe('connector credential reads', () => {
  it("refreshes the open list — and the mailbox reads on it — when another session's write is hinted", async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    renderHook(
      () => {
        useBackendHints(ORG);
        useConnectorCredentials(ORG);
        // The compose Inbox field and a thread's mailbox read the same
        // listing (`useEmailConnectors`, `useMailboxes`).
        useBackendQuery('connector_credentials/queries:listCredentials', {
          organizationId: ORG,
        });
      },
      { wrapper },
    );
    await waitFor(() => expect(fetchesOf(CONNECTOR_LIST)).toBe(1));

    act(() => {
      FakeEventSource.last?.emit(
        'hint',
        JSON.stringify({
          entity: CONNECTOR_CREDENTIAL_HINT_ENTITY,
          entityId: 'cred-1',
        }),
      );
    });

    // One listing, shared: one refetch serves every reader.
    await waitFor(() => expect(fetchesOf(CONNECTOR_LIST)).toBe(2));
  });

  it.each([
    ['Disable', () => useUpdateCredential(), { status: 'disabled' }],
    ['Make default', () => useSetDefaultCredential(), {}],
    ['Delete', () => useDeleteCredential(), {}],
  ] as const)(
    'refetches the list when %s names a credential another session deleted',
    async (_verb, useWrite, extra) => {
      const { result } = renderHook(
        () => {
          useConnectorCredentials(ORG);
          return useWrite();
        },
        { wrapper },
      );
      await waitFor(() => expect(fetchesOf(CONNECTOR_LIST)).toBe(1));
      writeAnswer = refusal(
        'CREDENTIAL_NOT_FOUND',
        'Credential not found.',
        404,
      );

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            organizationId: ORG,
            credentialId: 'cred-gone',
            ...extra,
          }),
        ).rejects.toMatchObject({ data: { code: 'CREDENTIAL_NOT_FOUND' } });
      });

      await waitFor(() => expect(fetchesOf(CONNECTOR_LIST)).toBe(2));
    },
  );

  it('leaves the list alone for a refusal that says nothing about it', async () => {
    const { result } = renderHook(
      () => {
        useConnectorCredentials(ORG);
        return useSetDefaultCredential();
      },
      { wrapper },
    );
    await waitFor(() => expect(fetchesOf(CONNECTOR_LIST)).toBe(1));
    writeAnswer = refusal('RATE_LIMITED', 'Slow down.', 429);

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          organizationId: ORG,
          credentialId: 'cred-1',
        }),
      ).rejects.toBeDefined();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchesOf(CONNECTOR_LIST)).toBe(1);
  });

  it('refetches the AI providers list the same way', async () => {
    const { result } = renderHook(
      () => {
        useProviderCredentials(ORG);
        return useDeleteProviderCredential();
      },
      { wrapper },
    );
    await waitFor(() => expect(fetchesOf(PROVIDER_LIST)).toBe(1));
    writeAnswer = refusal('CREDENTIAL_NOT_FOUND', 'Credential not found.', 404);

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          organizationId: ORG,
          credentialId: 'cred-gone',
        }),
      ).rejects.toBeDefined();
    });

    await waitFor(() => expect(fetchesOf(PROVIDER_LIST)).toBe(2));
  });
});

describe('refused credential saves (#3714)', () => {
  it.each([
    [
      'connectors create',
      () => useCreateCredential(),
      {
        connectorSlug: 'github',
        authMethod: 'bearer',
        name: 'GitHub',
        secret: { token: 'synthetic' },
      },
    ],
    ['connectors edit', () => useUpdateCredential(), { name: 'GitHub' }],
    [
      'AI providers create',
      () => useCreateProviderCredential(),
      { providerSlug: 'openrouter', authMethod: 'env', name: 'OpenRouter' },
    ],
    ['AI providers edit', () => useUpdateProviderCredential(), { name: 'x' }],
  ] as const)(
    'reports a refused %s once, in its dialog: no generic toast',
    async (_surface, useWrite, args) => {
      const { result } = renderHook(() => useWrite(), { wrapper });
      writeAnswer = refusal(
        'CREDENTIAL_NAME_TAKEN',
        'A credential named "GitHub" already exists for this connector — pick a different name.',
        409,
      );

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            organizationId: ORG,
            credentialId: 'cred-1',
            ...args,
          } as never),
        ).rejects.toMatchObject({ data: { code: 'CREDENTIAL_NAME_TAKEN' } });
      });

      expect(failureToasts()).toEqual([]);
    },
  );
});
