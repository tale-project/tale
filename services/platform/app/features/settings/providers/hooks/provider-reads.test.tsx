import { AppShell } from '@tale/ui/app-shell';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBuilderModelCatalog } from '@/app/features/automations/hooks/queries';
import { useProjectHarnesses } from '@/app/features/projects/hooks/queries';
import { useUnpinnedServingPreview } from '@/app/features/projects/hooks/use-unpinned-serving-preview';
import { useEmbeddingRecommendations } from '@/app/features/settings/data-residency/hooks/queries';
import { useUpsertGovernancePolicy } from '@/app/features/settings/governance/hooks/mutations';
import { useResolvedVisionModel } from '@/app/features/settings/governance/hooks/queries';
import { useBackendHints } from '@/app/lib/backend/use-backend-hints';
import { i18n } from '@/lib/i18n/i18n';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { useCreateCredential, useRefreshProviderCatalogs } from './mutations';
import { useHarnessStatus, useProviderCatalogs } from './queries';

/**
 * A provider an admin sets up has to reach every surface that answers from
 * the org's providers without a page reload. Those reads are fetched once and
 * then served from the cache, so the only thing that refreshes them is an
 * invalidation of the provider-credential entity — which a credential write,
 * a catalog refresh, a model-serving policy save and another session's hint
 * all fire. A read keyed outside that entity keeps its first answer: the
 * agent model pickers kept saying "No models found" after the first key was
 * added, until the page was reloaded.
 *
 * Real hooks, real adapter rows and a real query client; only `fetch` is
 * stubbed, answering like the backend.
 */

const ORG = 'org-providers';
const CATALOGS = '/api/app/providers/catalogs';

/** Every read that answers from what the org's providers serve. */
const PROVIDER_READS = [
  '/api/app/providers/harness-status',
  '/api/app/chat/composer/models',
  '/api/app/providers/vision-model',
  '/api/app/knowledge/embedding/recommendations',
  '/api/app/tasks/serving-preview',
] as const;

const MODEL = {
  id: 'gpt-5.5',
  label: 'GPT 5.5',
  providerSlug: 'openai',
  providerLabel: 'OpenAI',
  credential: { authMethod: 'api-key' },
};

const CREATE_ARGS = {
  organizationId: ORG,
  providerSlug: 'openai',
  authMethod: 'api-key',
  name: 'OpenAI',
  secret: 'sk-test',
} as const;

/** The GET paths the stubbed backend answered, in order. */
let gets: string[] = [];
/** The models the org's credentials serve — none until one is created. */
let servedModels: unknown[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
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
    if (path === '/api/app/provider-credentials') {
      servedModels = [MODEL];
      return json({ credentialId: 'cred-1' });
    }
    if (path === '/api/app/providers/catalogs/refresh') {
      return json({ results: [] });
    }
    if (path.startsWith('/api/app/governance/policies/')) {
      return json({ ok: true });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
  gets.push(path);
  switch (path) {
    case '/api/app/providers/harness-status':
      return json({ statuses: [] });
    case '/api/app/chat/composer/models':
      return json({
        models: servedModels,
        harnesses: [],
        voice: { ttsAvailable: false, transcriptionAvailable: false },
      });
    case '/api/app/providers/vision-model':
      return json({ pick: null });
    case '/api/app/knowledge/embedding/recommendations':
      return json({ recommendations: [] });
    case '/api/app/tasks/serving-preview':
      return json({ available: false });
    case CATALOGS:
      return json({ catalogs: [] });
    default:
      // The session probe and anything else this file does not exercise.
      return json({ error: 'UNAUTHORIZED' }, 401);
  }
}

function fetchesOf(path: string): number {
  return gets.filter((entry) => entry === path).length;
}

function expectEachProviderReadFetched(times: number): void {
  for (const path of PROVIDER_READS) {
    expect({ path, fetches: fetchesOf(path) }).toEqual({
      path,
      fetches: times,
    });
  }
}

/** The provider-derived reads as the pages mount them. */
function useProviderReads(): void {
  useHarnessStatus(ORG);
  useProjectHarnesses(ORG);
  useResolvedVisionModel(ORG);
  useEmbeddingRecommendations(ORG);
  useUnpinnedServingPreview('task', {
    organizationId: ORG,
    model: MODEL.id,
    harness: 'claude-code',
  });
}

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

beforeEach(() => {
  queryClient = new QueryClient();
  gets = [];
  servedModels = [];
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input, init) =>
    Promise.resolve(backend(input, init)),
  );
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__ENV__;
  FakeEventSource.last = undefined;
});

describe('provider-derived reads', () => {
  it('lists a new provider in an agent model picker opened before it existed', async () => {
    // The reported path: the picker is opened on an org with no provider,
    // the admin adds a key in settings, then comes back to the picker.
    const picker = renderHook(() => useProjectHarnesses(ORG), { wrapper });
    await waitFor(() => expect(picker.result.current.data?.models).toEqual([]));
    picker.unmount();

    const settings = renderHook(() => useCreateCredential(), { wrapper });
    await act(() => settings.result.current.mutateAsync(CREATE_ARGS));

    const reopened = renderHook(() => useProjectHarnesses(ORG), { wrapper });
    await waitFor(() =>
      expect(reopened.result.current.data?.models).toEqual([MODEL]),
    );
  });

  it('refreshes every provider-derived read on screen when a credential is written', async () => {
    renderHook(() => useProviderReads(), { wrapper });
    await waitFor(() => expectEachProviderReadFetched(1));

    const settings = renderHook(() => useCreateCredential(), { wrapper });
    await act(() => settings.result.current.mutateAsync(CREATE_ARGS));

    await waitFor(() => expectEachProviderReadFetched(2));
  });

  it("refreshes them when another session's credential write is hinted", async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    renderHook(
      () => {
        useBackendHints(ORG);
        useProviderReads();
      },
      { wrapper },
    );
    await waitFor(() => expectEachProviderReadFetched(1));

    act(() => {
      FakeEventSource.last?.emit(
        'hint',
        JSON.stringify({ entity: PROVIDER_CREDENTIAL_HINT_ENTITY }),
      );
    });

    await waitFor(() => expectEachProviderReadFetched(2));
  });

  it('carries a catalog refresh to every catalog listing and the reads built on them', async () => {
    const { result } = renderHook(
      () => {
        useProviderReads();
        useProviderCatalogs(ORG);
        useBuilderModelCatalog(ORG, true);
        return useRefreshProviderCatalogs(ORG);
      },
      { wrapper },
    );
    // The providers page and the automation builder share one listing.
    await waitFor(() => {
      expectEachProviderReadFetched(1);
      expect(fetchesOf(CATALOGS)).toBe(1);
    });

    await act(() => result.current.mutateAsync({ organizationId: ORG }));

    await waitFor(() => {
      expectEachProviderReadFetched(2);
      expect(fetchesOf(CATALOGS)).toBe(2);
    });
  });

  it.each(['model_access', 'vision_model'])(
    're-resolves them when the %s policy is saved',
    async (policyType) => {
      const { result } = renderHook(
        () => {
          useProviderReads();
          return useUpsertGovernancePolicy();
        },
        { wrapper },
      );
      await waitFor(() => expectEachProviderReadFetched(1));

      await act(() =>
        result.current.mutateAsync({
          organizationId: ORG,
          policyType,
          config: {},
        }),
      );

      await waitFor(() => expectEachProviderReadFetched(2));
    },
  );

  it('leaves them alone when a policy that picks no model is saved', async () => {
    const { result } = renderHook(
      () => {
        useProviderReads();
        return useUpsertGovernancePolicy();
      },
      { wrapper },
    );
    await waitFor(() => expectEachProviderReadFetched(1));

    await act(async () => {
      await result.current.mutateAsync({
        organizationId: ORG,
        policyType: 'password_policy',
        config: {},
      });
    });

    expectEachProviderReadFetched(1);
  });
});
