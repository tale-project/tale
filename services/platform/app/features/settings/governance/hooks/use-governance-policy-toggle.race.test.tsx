// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpsertGovernancePolicy } from './mutations';
import { useGovernancePolicy } from './queries';
import { useGovernancePolicyToggle } from './use-governance-policy-toggle';

// A slow switch write must not revert a newer Save of the same policy
// (#4048). The real hook, react-query and adapter row run here. `fetch`
// stands in for the server: it applies each POST when the request arrives,
// as the governance door does.

const toastMock = vi.fn();
vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isAuthenticated: true }),
}));

const ORG = 'org-1';
const TYPE = 'session_idle_timeout';
const POLICY_URL = `/api/app/governance/policies/${TYPE}?orgId=${ORG}`;

interface IdleConfig {
  enabled: boolean;
  idleTimeoutMinutes: number;
}

/** The config the server holds, and every config it applied, in order. */
let server: IdleConfig;
let applied: IdleConfig[];
/** Requests the test holds; each resolves when its `release` runs. */
let heldPosts: Array<() => void>;
let holdNextPost: boolean;
let heldReads: Array<() => void>;
let holdReads: boolean;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function idleConfigOf(value: unknown): IdleConfig | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('enabled' in value) ||
    !('idleTimeoutMinutes' in value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.idleTimeoutMinutes !== 'number'
  ) {
    return undefined;
  }
  return {
    enabled: value.enabled,
    idleTimeoutMinutes: value.idleTimeoutMinutes,
  };
}

function postedConfig(body: BodyInit | null | undefined): IdleConfig {
  if (typeof body !== 'string') throw new Error('expected a JSON body');
  const parsed: unknown = JSON.parse(body);
  const config =
    parsed !== null && typeof parsed === 'object' && 'config' in parsed
      ? idleConfigOf(parsed.config)
      : undefined;
  if (config === undefined) {
    throw new Error('expected {config: {enabled, idleTimeoutMinutes}}');
  }
  return config;
}

let posts = 0;

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  server = { enabled: false, idleTimeoutMinutes: 30 };
  applied = [];
  heldPosts = [];
  holdNextPost = false;
  heldReads = [];
  holdReads = false;
  posts = 0;
  toastMock.mockReset();
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = urlOf(input);
    if (url !== POLICY_URL) throw new Error(`unexpected request ${url}`);
    if (init?.method === 'POST') {
      posts += 1;
      const config = postedConfig(init.body);
      if (holdNextPost) {
        holdNextPost = false;
        await new Promise<void>((resolve) => heldPosts.push(resolve));
      }
      server = config;
      applied.push(config);
      return Response.json({ ok: true });
    }
    if (holdReads) {
      await new Promise<void>((resolve) => heldReads.push(resolve));
    }
    return Response.json({ policy: { key: TYPE, config: server } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

/** One editor's wiring, as the session idle timeout editor has it. */
function useIdleEditor() {
  const policy = useGovernancePolicy(ORG, TYPE);
  const saved = idleConfigOf(policy.data?.config);
  const toggle = useGovernancePolicyToggle({
    organizationId: ORG,
    policyType: TYPE,
    savedEnabled: saved?.enabled ?? false,
    isLoading: policy.isLoading,
    buildConfig: (next): IdleConfig => ({
      enabled: next,
      idleTimeoutMinutes: saved?.idleTimeoutMinutes ?? 30,
    }),
    failureTitle: 'Save failed',
    failureDescription: 'Could not save the policy',
  });
  const upsert = useUpsertGovernancePolicy({ errorToast: false });
  return { saved, toggle, upsert };
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useIdleEditor(), { wrapper });
  return { ...rendered, client };
}

const releaseAll = (held: Array<() => void>) => {
  for (const release of held.splice(0)) release();
};

describe('useGovernancePolicyToggle beside the editor’s save', () => {
  it('keeps a Save made while the switch’s write is pending: the Save lands last', async () => {
    const { result, client } = renderEditor();
    await waitFor(() => expect(result.current.saved).toBeDefined());

    // The switch goes on and its write is held, like a slow network.
    holdNextPost = true;
    let toggled: Promise<void> | undefined;
    act(() => {
      toggled = result.current.toggle.onToggle(true);
    });
    await waitFor(() => expect(heldPosts).toHaveLength(1));
    expect(result.current.toggle.enabled).toBe(true);

    // The minutes field it revealed is edited and saved, as the editor's
    // `save` builds it: the switch's state plus the form's values.
    let saving: Promise<unknown> | undefined;
    act(() => {
      saving = result.current.upsert.mutateAsync({
        organizationId: ORG,
        policyType: TYPE,
        config: { enabled: true, idleTimeoutMinutes: 15 },
      });
    });
    // The Save waits for the switch's write rather than overtaking it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1);

    releaseAll(heldPosts);
    await act(async () => {
      await toggled;
      await saving;
    });
    await waitFor(() => expect(result.current.toggle.isSettling).toBe(false));

    expect(server).toEqual({ enabled: true, idleTimeoutMinutes: 15 });
    expect(applied).toEqual([
      { enabled: true, idleTimeoutMinutes: 30 },
      { enabled: true, idleTimeoutMinutes: 15 },
    ]);
    expect(result.current.saved).toEqual({
      enabled: true,
      idleTimeoutMinutes: 15,
    });
    expect(toastMock).not.toHaveBeenCalled();
    client.clear();
  });

  it('holds the switch while a Save of the policy is pending', async () => {
    const { result, client } = renderEditor();
    await waitFor(() => expect(result.current.saved).toBeDefined());
    expect(result.current.toggle.isSettling).toBe(false);

    holdNextPost = true;
    let saving: Promise<unknown> | undefined;
    act(() => {
      saving = result.current.upsert.mutateAsync({
        organizationId: ORG,
        policyType: TYPE,
        config: { enabled: false, idleTimeoutMinutes: 45 },
      });
    });
    await waitFor(() => expect(heldPosts).toHaveLength(1));
    // Not only the form's `isSaving`: any write of the policy holds it,
    // a rule table's instant save included.
    expect(result.current.toggle.isSettling).toBe(true);

    releaseAll(heldPosts);
    await act(async () => {
      await saving;
    });
    await waitFor(() => expect(result.current.toggle.isSettling).toBe(false));
    expect(server).toEqual({ enabled: false, idleTimeoutMinutes: 45 });
    client.clear();
  });

  it('holds the switch until the policy is read back after a Save, then builds from it', async () => {
    const { result, client } = renderEditor();
    await waitFor(() => expect(result.current.saved).toBeDefined());
    act(() => {
      void result.current.toggle.onToggle(true);
    });
    await waitFor(() =>
      expect(result.current.saved).toEqual({
        enabled: true,
        idleTimeoutMinutes: 30,
      }),
    );
    await waitFor(() => expect(result.current.toggle.isSettling).toBe(false));

    // The Save lands, but its re-read is slow.
    holdReads = true;
    await act(async () => {
      await result.current.upsert.mutateAsync({
        organizationId: ORG,
        policyType: TYPE,
        config: { enabled: true, idleTimeoutMinutes: 15 },
      });
    });
    expect(server).toEqual({ enabled: true, idleTimeoutMinutes: 15 });
    // The saved config the switch would build from is still the old one.
    expect(result.current.saved).toEqual({
      enabled: true,
      idleTimeoutMinutes: 30,
    });
    expect(result.current.toggle.isSettling).toBe(true);
    // The live hint for that write invalidates the read again, replacing
    // the fetch in flight: the switch waits for the replacement too.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      void client.invalidateQueries({
        queryKey: ['backend', ORG, 'governance_policy'],
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(heldReads.length).toBeGreaterThanOrEqual(2);
    expect(result.current.toggle.isSettling).toBe(true);

    holdReads = false;
    releaseAll(heldReads);
    await waitFor(() => expect(result.current.toggle.isSettling).toBe(false));
    expect(result.current.saved).toEqual({
      enabled: true,
      idleTimeoutMinutes: 15,
    });

    await act(async () => {
      await result.current.toggle.onToggle(false);
    });
    expect(server).toEqual({ enabled: false, idleTimeoutMinutes: 15 });
    client.clear();
  });

  it('still lands the Save when the switch’s write it waited for fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, client } = renderEditor();
    await waitFor(() => expect(result.current.saved).toBeDefined());

    vi.mocked(window.fetch).mockImplementationOnce(async () => {
      posts += 1;
      await new Promise<void>((resolve) => heldPosts.push(resolve));
      return Response.json({ error: 'boom' }, { status: 500 });
    });
    let toggled: Promise<void> | undefined;
    act(() => {
      toggled = result.current.toggle.onToggle(true);
    });
    await waitFor(() => expect(heldPosts).toHaveLength(1));
    let saving: Promise<unknown> | undefined;
    act(() => {
      saving = result.current.upsert.mutateAsync({
        organizationId: ORG,
        policyType: TYPE,
        config: { enabled: true, idleTimeoutMinutes: 15 },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1);

    releaseAll(heldPosts);
    await act(async () => {
      await toggled;
      await saving;
    });
    // The switch reports its own failure; the Save after it still lands.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Save failed', variant: 'destructive' }),
    );
    expect(server).toEqual({ enabled: true, idleTimeoutMinutes: 15 });
    await waitFor(() => expect(result.current.toggle.enabled).toBe(true));
    errorSpy.mockRestore();
    client.clear();
  });
});
