import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ErrorScopeProvider, useErrorScope } from './error-scope';

describe('useErrorScope', () => {
  it('carries no organization outside a provider', () => {
    const { result } = renderHook(() => useErrorScope());
    expect(result.current.organizationId).toBeUndefined();
  });

  it('reads the organization the nearest provider scopes to', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ErrorScopeProvider organizationId="org_outer">
        <ErrorScopeProvider organizationId="org_inner">
          {children}
        </ErrorScopeProvider>
      </ErrorScopeProvider>
    );
    const { result } = renderHook(() => useErrorScope(), { wrapper });
    expect(result.current.organizationId).toBe('org_inner');
  });

  it('keeps a stable value while the organization is unchanged', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ErrorScopeProvider organizationId="org_1">{children}</ErrorScopeProvider>
    );
    const { result, rerender } = renderHook(() => useErrorScope(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
