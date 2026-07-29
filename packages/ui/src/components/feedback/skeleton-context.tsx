'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';

interface SkeletonContextValue {
  /** When true, descendant skeleton-aware leaves mask themselves. */
  loading: boolean;
}

const SkeletonContext = createContext<SkeletonContextValue>({ loading: false });

/**
 * Read by every skeleton-aware leaf (Input, Textarea, Switch, Select, Text,
 * Badge, Button). Returns `false` outside any `<Skeletonize>` provider, so
 * components behave exactly as before unless explicitly wrapped.
 */
export function useSkeleton(): boolean {
  return useContext(SkeletonContext).loading;
}

interface SkeletonizeProps {
  /** While true, descendant skeleton-aware leaves render as pulse blocks. */
  loading: boolean;
  /** The REAL component tree — rendered identically in both states. */
  children: ReactNode;
  /**
   * Accessible label announced once for the whole region while loading.
   * Defaults to the translated `skeleton.loading` string.
   */
  label?: string;
  /** Classes for the wrapper element (present in both states → no shift). */
  className?: string;
}

/**
 * Wrap a region of REAL component JSX. While `loading`, descendant
 * skeleton-aware leaves mask themselves to their NATURAL size — so the
 * skeleton's height equals the content's height by construction (there is no
 * separate skeleton tree to drift). Static headings/labels keep rendering
 * their real text (they're known at load time and read better than gray bars).
 *
 * The wrapper element is present in both states so toggling `loading` never
 * shifts layout. A single `role="status"`/`aria-busy` lives here while masked
 * (individual masked leaves are `aria-hidden`), so screen readers announce
 * "Loading" once, not per leaf.
 *
 * For data that arrives via `useSuspenseConvexQuery`, prefer letting the
 * enclosing Suspense fallback render the skeletonized tree. Use
 * `<Skeletonize>` inline to mask a section whose data loads via a
 * non-suspending read.
 */
export function Skeletonize({
  loading,
  children,
  label,
  className,
}: SkeletonizeProps) {
  const { t } = useT('skeleton');
  const resolvedLabel = label ?? t('loading');
  const value = useMemo(() => ({ loading }), [loading]);
  return (
    <SkeletonContext.Provider value={value}>
      <div
        role={loading ? 'status' : undefined}
        aria-busy={loading || undefined}
        aria-label={loading ? resolvedLabel : undefined}
        className={cn(className)}
      >
        {children}
        {loading && <span className="sr-only">{resolvedLabel}</span>}
      </div>
    </SkeletonContext.Provider>
  );
}
