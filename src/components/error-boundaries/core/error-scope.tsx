'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface ErrorScope {
  /**
   * The organization the surface belongs to. Error displays append it to the
   * support link and boundaries pass it to their loggers. Undefined outside an
   * organization (auth pages, standalone consumers).
   */
  organizationId?: string;
}

const ErrorScopeContext = createContext<ErrorScope>({});
ErrorScopeContext.displayName = 'ErrorScopeContext';

/**
 * Scopes every error boundary beneath it to an organization. The platform
 * mounts one per dashboard route; a consumer without organizations never
 * needs it — the boundaries simply carry no id.
 */
export function ErrorScopeProvider({
  organizationId,
  children,
}: ErrorScope & { children: ReactNode }) {
  const value = useMemo(() => ({ organizationId }), [organizationId]);
  return (
    <ErrorScopeContext.Provider value={value}>
      {children}
    </ErrorScopeContext.Provider>
  );
}

/** The error scope a boundary or display should report under. */
export function useErrorScope(): ErrorScope {
  return useContext(ErrorScopeContext);
}
