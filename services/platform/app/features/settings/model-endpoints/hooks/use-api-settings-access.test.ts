import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listedApiAccess,
  tabDeniedMessageKey,
  visibleApiNavItems,
} from '@/app/routes/dashboard/$id/settings/api/-nav-items';

import { useApiSettingsAccess } from './use-api-settings-access';

/**
 * Who opens which API settings tab: owners, admins and developers every tab;
 * a member who may create a personal API key (a competence that is used with
 * one) the REST tab, where the key is made; one who may call the model
 * endpoints (a `tale:models.api` grant) the Models tab as well; one who may
 * connect a coding agent here, while the deployment lets agents sign in, or
 * holds a live connection, Connected agents — which no role opens by itself;
 * anyone else none.
 */

/** The part of a read's result the hook reads; a test sets what it needs. */
interface Read<T> {
  isLoading: boolean;
  data: T | undefined;
  isError?: boolean;
  isFetching?: boolean;
  errorUpdateCount?: number;
  error?: Error | null;
  refetch?: () => Promise<unknown>;
}

const state = vi.hoisted(
  (): {
    developer: boolean;
    abilityLoading: boolean;
    standing: Read<{ allowed: boolean }>;
    keys: Read<{ mayCreate: boolean; holdsKeys: boolean }>;
    agentAccess: Read<{
      mayConnect: boolean;
      holdsConnection: boolean;
      signInOn: boolean;
    }>;
  } => ({
    developer: false,
    abilityLoading: false,
    standing: { isLoading: false, data: undefined },
    keys: { isLoading: false, data: undefined },
    agentAccess: { isLoading: false, data: undefined },
  }),
);

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.developer }),
  useAbilityLoading: () => state.abilityLoading,
}));

vi.mock('@/app/features/settings/agent-connections/hooks/queries', () => ({
  useAgentConnectionAccess: () => state.agentAccess,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyModelApiAccess: () => state.standing,
  useMyApiKeyAccess: () => state.keys,
}));

beforeEach(() => {
  state.developer = false;
  state.abilityLoading = false;
  state.standing = { isLoading: false, data: undefined };
  state.keys = { isLoading: false, data: undefined };
  state.agentAccess = { isLoading: false, data: undefined };
});

const NOTHING_UNDECIDED = { apiKeys: false, modelApi: false, agents: false };

/** A read that answered. */
function answered<T>(data: T): Read<T> {
  return { isLoading: false, data, errorUpdateCount: 0, refetch: vi.fn() };
}

/** A read whose retry policy gave up before it ever answered. */
function failed<T>(failures = 1): Read<T> {
  return {
    isLoading: false,
    data: undefined,
    isError: true,
    isFetching: false,
    errorUpdateCount: failures,
    error: new Error('Service unavailable'),
    refetch: vi.fn(),
  };
}

/** That read asked again: react-query puts it back to pending meanwhile. */
function askedAgain<T>(): Read<T> {
  return {
    isLoading: true,
    data: undefined,
    isError: false,
    isFetching: true,
    errorUpdateCount: 1,
    error: null,
    refetch: vi.fn(),
  };
}

/** What the connections answer, the deployment letting agents sign in unless
 * said otherwise. */
function connections(
  answer: Partial<{
    mayConnect: boolean;
    holdsConnection: boolean;
    signInOn: boolean;
  }>,
) {
  return {
    isLoading: false,
    data: {
      mayConnect: false,
      holdsConnection: false,
      signInOn: true,
      ...answer,
    },
  };
}

describe('useApiSettingsAccess', () => {
  it('opens every API tab to a developer role, without waiting on the grants', () => {
    state.developer = true;
    state.standing = { isLoading: true, data: undefined };
    state.keys = { isLoading: true, data: undefined };
    state.agentAccess = connections({ mayConnect: true });
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      undecided: NOTHING_UNDECIDED,
      developer: true,
      apiKeys: true,
      createApiKeys: true,
      modelApi: true,
      agents: true,
      connectAgents: true,
      loading: false,
    });
  });

  it('opens the model tabs to a member holding the grant', () => {
    state.standing = { isLoading: false, data: { allowed: true } };
    state.keys = {
      isLoading: false,
      data: { mayCreate: true, holdsKeys: false },
    };
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      undecided: NOTHING_UNDECIDED,
      developer: false,
      apiKeys: true,
      createApiKeys: true,
      modelApi: true,
      agents: false,
      connectAgents: false,
      loading: false,
    });
  });

  it('opens the key tab alone to a member who may create a key for another door', () => {
    state.standing = { isLoading: false, data: { allowed: false } };
    state.keys = {
      isLoading: false,
      data: { mayCreate: true, holdsKeys: false },
    };
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      undecided: NOTHING_UNDECIDED,
      developer: false,
      apiKeys: true,
      createApiKeys: true,
      modelApi: false,
      agents: false,
      connectAgents: false,
      loading: false,
    });
  });

  it('keeps the key tab, without Create, for a member who holds a key after the right lapsed', () => {
    state.standing = { isLoading: false, data: { allowed: false } };
    state.keys = {
      isLoading: false,
      data: { mayCreate: false, holdsKeys: true },
    };
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      undecided: NOTHING_UNDECIDED,
      developer: false,
      apiKeys: true,
      createApiKeys: false,
      modelApi: false,
      agents: false,
      connectAgents: false,
      loading: false,
    });
  });

  it('opens Connected agents to a member who may connect a coding agent here [AGCONN-R23]', () => {
    state.agentAccess = connections({ mayConnect: true });
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      undecided: NOTHING_UNDECIDED,
      developer: false,
      apiKeys: false,
      createApiKeys: false,
      modelApi: false,
      agents: true,
      connectAgents: true,
      loading: false,
    });
  });

  it('does not offer a way to connect an agent while the deployment does not let agents sign in [AGCONN-R23]', () => {
    state.developer = true;
    state.agentAccess = connections({ mayConnect: true, signInOn: false });
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    // Every other tab is a developer role's by right; this one is not.
    expect(result.current).toMatchObject({
      developer: true,
      apiKeys: true,
      modelApi: true,
      agents: false,
      connectAgents: false,
    });
  });

  it('keeps Connected agents for a member who holds a connection after the right lapsed or the sign-in was switched off [AGCONN-R23]', () => {
    state.agentAccess = connections({ holdsConnection: true });
    const lapsed = renderHook(() => useApiSettingsAccess('org-1'));
    expect(lapsed.result.current.agents).toBe(true);
    expect(lapsed.result.current.connectAgents).toBe(false);
    expect(lapsed.result.current.apiKeys).toBe(false);

    state.agentAccess = connections({
      holdsConnection: true,
      mayConnect: true,
      signInOn: false,
    });
    const off = renderHook(() => useApiSettingsAccess('org-1'));
    expect(off.result.current.agents).toBe(true);
    expect(off.result.current.connectAgents).toBe(false);
  });

  it('closes Connected agents to a member with neither [AGCONN-R23]', () => {
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current.agents).toBe(false);
  });

  it('waits for the connections, a developer role included, as the tab is not the role’s by right', () => {
    state.developer = true;
    state.agentAccess = { isLoading: true, data: undefined };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.agents).toBe(false);
  });

  it.each([
    ['the model grant', { standing: true, keys: false, agents: false }],
    ['the key rule', { standing: false, keys: true, agents: false }],
    ['the connections', { standing: false, keys: false, agents: true }],
  ])('waits for %s before deciding for any other member', (_what, loading) => {
    state.standing = { isLoading: loading.standing, data: undefined };
    state.keys = { isLoading: loading.keys, data: undefined };
    state.agentAccess = { isLoading: loading.agents, data: undefined };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.apiKeys).toBe(false);
    expect(result.current.modelApi).toBe(false);
    expect(result.current.agents).toBe(false);
  });
});

// #4767: a read that failed used to read as "no access" — the section, or a
// tab the member may open, refused them with nothing to try again.
describe('useApiSettingsAccess when a read fails', () => {
  it('leaves REST and Models undecided for a member whose model grant read failed, never closed', () => {
    state.standing = failed();
    state.keys = answered({ mayCreate: false, holdsKeys: false });
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      apiKeys: false,
      createApiKeys: false,
      modelApi: false,
      undecided: { apiKeys: true, modelApi: true, agents: false },
      error: state.standing.error,
      retrying: false,
      loading: false,
    });
  });

  it('keeps REST open on the key rule while the model grant read fails, Models alone undecided', () => {
    state.standing = failed();
    state.keys = answered({ mayCreate: true, holdsKeys: false });
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      apiKeys: true,
      createApiKeys: true,
      modelApi: false,
      undecided: { apiKeys: false, modelApi: true, agents: false },
    });
  });

  it('leaves REST undecided while the key rule read fails and the model grant does not open it', () => {
    state.standing = answered({ allowed: false });
    state.keys = failed();
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      apiKeys: false,
      modelApi: false,
      undecided: { apiKeys: true, modelApi: false, agents: false },
      error: state.keys.error,
    });
  });

  it('opens REST and Models on the model grant, whatever the key rule read did', () => {
    state.standing = answered({ allowed: true });
    state.keys = failed();
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      apiKeys: true,
      createApiKeys: true,
      modelApi: true,
      undecided: NOTHING_UNDECIDED,
      error: null,
    });
  });

  it('decides nothing on a developer role’s failed grant reads', () => {
    state.developer = true;
    state.standing = failed();
    state.keys = failed();
    state.agentAccess = connections({ mayConnect: true });
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      apiKeys: true,
      modelApi: true,
      agents: true,
      undecided: NOTHING_UNDECIDED,
      error: null,
      loading: false,
    });
    result.current.retry();
    expect(state.standing.refetch).not.toHaveBeenCalled();
    expect(state.keys.refetch).not.toHaveBeenCalled();
  });

  it('leaves Connected agents undecided while the connections read fails, a developer role included', () => {
    state.developer = true;
    state.agentAccess = failed();
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      agents: false,
      connectAgents: false,
      undecided: { apiKeys: false, modelApi: false, agents: true },
      error: state.agentAccess.error,
      loading: false,
    });
  });

  it('stays undecided, not loading, while a failed read is asked again', () => {
    state.standing = askedAgain();
    state.keys = answered({ mayCreate: false, holdsKeys: false });
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      undecided: { apiKeys: true, modelApi: true, agents: false },
      retrying: true,
      loading: false,
    });
  });

  it('asks only the reads that failed again', () => {
    state.standing = failed();
    state.keys = answered({ mayCreate: false, holdsKeys: false });
    state.agentAccess = failed(2);
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    // Every settled failure counts, so a notice keyed on it is announced
    // afresh each time.
    expect(result.current.failureCount).toBe(3);
    result.current.retry();
    expect(state.standing.refetch).toHaveBeenCalledTimes(1);
    expect(state.keys.refetch).not.toHaveBeenCalled();
    expect(state.agentAccess.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps deciding by the last answer when a refresh fails', () => {
    state.standing = { ...answered({ allowed: true }), isError: true };
    state.keys = answered({ mayCreate: true, holdsKeys: false });
    state.agentAccess = connections({});
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toMatchObject({
      modelApi: true,
      undecided: NOTHING_UNDECIDED,
      error: null,
    });
  });
});

describe('listedApiAccess', () => {
  it('lists the tabs a failed read left undecided beside the open ones', () => {
    const slugs = (access: Parameters<typeof listedApiAccess>[0]) =>
      visibleApiNavItems(listedApiAccess(access)).map((item) => item.slug);
    expect(
      slugs({
        developer: false,
        apiKeys: true,
        modelApi: false,
        agents: false,
        undecided: { apiKeys: false, modelApi: true, agents: false },
      }),
    ).toEqual(['rest', 'models']);
    expect(
      slugs({
        developer: true,
        apiKeys: true,
        modelApi: true,
        agents: false,
        undecided: { apiKeys: false, modelApi: false, agents: true },
      }),
    ).toEqual(['rest', 'models', 'mcp', 'agents', 'webdav']);
    expect(
      slugs({
        developer: false,
        apiKeys: false,
        modelApi: false,
        agents: false,
        undecided: NOTHING_UNDECIDED,
      }),
    ).toEqual([]);
  });
});

describe('visibleApiNavItems', () => {
  const slugs = (access: {
    developer: boolean;
    apiKeys: boolean;
    modelApi: boolean;
    agents: boolean;
  }) => visibleApiNavItems(access).map((item) => item.slug);

  it('lists every tab for a developer role, Models beside REST and Connected agents beside MCP', () => {
    expect(
      slugs({ developer: true, apiKeys: true, modelApi: true, agents: true }),
    ).toEqual(['rest', 'models', 'mcp', 'agents', 'webdav']);
  });

  it('leaves Connected agents out for a developer role while agents may not sign in [AGCONN-R23]', () => {
    expect(
      slugs({ developer: true, apiKeys: true, modelApi: true, agents: false }),
    ).toEqual(['rest', 'models', 'mcp', 'webdav']);
  });

  it('lists REST and Models alone for a member holding the model grant', () => {
    expect(
      slugs({
        developer: false,
        apiKeys: true,
        modelApi: true,
        agents: false,
      }),
    ).toEqual(['rest', 'models']);
  });

  it('lists REST alone for a member who may create a key for another door', () => {
    expect(
      slugs({
        developer: false,
        apiKeys: true,
        modelApi: false,
        agents: false,
      }),
    ).toEqual(['rest']);
  });

  it('lists Connected agents alone for a member who may connect a coding agent [AGCONN-R23]', () => {
    expect(
      slugs({
        developer: false,
        apiKeys: false,
        modelApi: false,
        agents: true,
      }),
    ).toEqual(['agents']);
  });

  it('lists nothing for any other member', () => {
    expect(
      slugs({
        developer: false,
        apiKeys: false,
        modelApi: false,
        agents: false,
      }),
    ).toEqual([]);
  });
});

describe('tabDeniedMessageKey', () => {
  it('says what opens a tab that a member’s grant opens, and the roles for the rest [AGCONN-R23]', () => {
    expect(tabDeniedMessageKey({ audience: 'modelApi' })).toBe('apiModels');
    expect(tabDeniedMessageKey({ audience: 'agents' })).toBe('apiAgents');
    expect(tabDeniedMessageKey({ audience: 'developer' })).toBe('apiTab');
    expect(tabDeniedMessageKey({ audience: 'apiKeys' })).toBe('apiTab');
  });
});
