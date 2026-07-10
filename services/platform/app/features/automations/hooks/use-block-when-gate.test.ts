// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBlockWhenGate } from './use-block-when-gate';

vi.mock('../runtime/automation-runtime', () => ({
  useAutomationRuntime: () => ({
    organizationId: 'org1',
    projectId: 'proj1',
    automationSlug: 'demo',
    allowlist: [
      { path: 'projects/queries:getProjectSetupFolder', mode: 'query' },
    ],
    config: {},
  }),
}));

vi.mock('../runtime/view-state', () => ({
  useOptionalViewState: () => null,
}));

let gateQueryReturn: {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  blocked: boolean;
  needsConfig: boolean;
};

vi.mock('./use-bound-query', () => ({
  useBoundQuery: () => gateQueryReturn,
}));

afterEach(() => {
  gateQueryReturn = {
    data: undefined,
    isLoading: false,
    error: null,
    blocked: false,
    needsConfig: false,
  };
});

describe('useBlockWhenGate', () => {
  it('is ungated when when is omitted', () => {
    gateQueryReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      blocked: false,
      needsConfig: false,
    };
    const { result } = renderHook(() => useBlockWhenGate(undefined, undefined));
    expect(result.current).toEqual({ decision: 'ungated' });
  });

  it('is pending while the gate query loads', () => {
    gateQueryReturn = {
      data: undefined,
      isLoading: true,
      error: null,
      blocked: false,
      needsConfig: false,
    };
    const { result } = renderHook(() =>
      useBlockWhenGate('!_id', {
        path: 'projects/queries:getProjectSetupFolder',
        args: { projectId: '$projectId' },
      }),
    );
    expect(result.current).toEqual({ decision: 'pending' });
  });

  it('shows when the predicate passes against an empty record', () => {
    gateQueryReturn = {
      data: null,
      isLoading: false,
      error: null,
      blocked: false,
      needsConfig: false,
    };
    const { result } = renderHook(() =>
      useBlockWhenGate('!_id', {
        path: 'projects/queries:getProjectSetupFolder',
        args: {},
      }),
    );
    expect(result.current).toEqual({ decision: 'show' });
  });

  it('hides when the predicate fails', () => {
    gateQueryReturn = {
      data: { _id: 'folder_setup' },
      isLoading: false,
      error: null,
      blocked: false,
      needsConfig: false,
    };
    const { result } = renderHook(() =>
      useBlockWhenGate('!_id', {
        path: 'projects/queries:getProjectSetupFolder',
        args: {},
      }),
    );
    expect(result.current).toEqual({ decision: 'hide' });
  });
});
