'use client';

import { createContext } from 'react';
import type { ErrorBoundaryContextValue } from './types';

/**
 * Context for providing error boundary state to descendant components.
 *
 * This allows deeply nested components to:
 * - Check if they're within an error state
 * - Trigger manual resets
 * - Access error metadata
 */
export const ErrorBoundaryContext = createContext<ErrorBoundaryContextValue | null>(null);

ErrorBoundaryContext.displayName = 'ErrorBoundaryContext';
