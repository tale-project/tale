'use client';

import { HStack } from '@tale/ui/layout';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { cn } from '@/lib/utils/cn';

// =============================================================================
// Context
// =============================================================================

interface AdaptiveHeaderContextValue {
  headerContent: ReactNode;
  setHeaderContent: (content: ReactNode) => void;
}

const AdaptiveHeaderContext = createContext<AdaptiveHeaderContextValue | null>(
  null,
);

function useAdaptiveHeader() {
  const context = useContext(AdaptiveHeaderContext);
  if (!context) {
    throw new Error(
      'useAdaptiveHeader must be used within AdaptiveHeaderProvider',
    );
  }
  return context;
}

function useAdaptiveHeaderContent() {
  const context = useContext(AdaptiveHeaderContext);
  return context?.headerContent ?? null;
}

// =============================================================================
// Provider
// =============================================================================

interface AdaptiveHeaderProviderProps {
  children: ReactNode;
}

export function AdaptiveHeaderProvider({
  children,
}: AdaptiveHeaderProviderProps) {
  const [headerContent, setHeaderContent] = useState<ReactNode>(null);

  const value = useMemo(
    () => ({ headerContent, setHeaderContent }),
    [headerContent],
  );

  return (
    <AdaptiveHeaderContext.Provider value={value}>
      {children}
    </AdaptiveHeaderContext.Provider>
  );
}

// =============================================================================
// Slot (renders in mobile nav bar)
// =============================================================================

interface AdaptiveHeaderSlotProps {
  className?: string;
}

export function AdaptiveHeaderSlot({ className }: AdaptiveHeaderSlotProps) {
  const content = useAdaptiveHeaderContent();
  const isMobile = useIsMobile();

  if (!content) return null;

  return (
    // The slot is the *mobile* mirror of the header content (which the desktop
    // `AdaptiveHeaderRoot` also renders). Both copies carry the page-title
    // `h1`, so the inactive copy must be removed from the accessibility tree —
    // otherwise AT sees a duplicate heading. CSS `display:none` already hides
    // it visually; `aria-hidden` makes the intent explicit and keeps exactly
    // one copy exposed even where the responsive stylesheet isn't applied.
    <div
      aria-hidden={!isMobile || undefined}
      className={cn('flex min-w-0 flex-1 items-center', className)}
    >
      {content}
    </div>
  );
}

// =============================================================================
// Root Component
// =============================================================================

interface AdaptiveHeaderRootProps {
  children: ReactNode;
  className?: string;
  /**
   * Whether to show a border at the bottom of the header.
   * @default false
   */
  showBorder?: boolean;
  /**
   * When true (default), applies sticky positioning, backdrop blur, and z-index.
   * When false, renders without sticky/blur for use inside StickyHeader wrapper.
   * @default true
   */
  standalone?: boolean;
}

export function AdaptiveHeaderRoot({
  children,
  className,
  showBorder = false,
  standalone = true,
}: AdaptiveHeaderRootProps) {
  const { setHeaderContent } = useAdaptiveHeader();
  const isMobile = useIsMobile();

  // Register children with context for mobile rendering
  useEffect(() => {
    setHeaderContent(children);
    return () => setHeaderContent(null);
  }, [children, setHeaderContent]);

  return (
    <HStack
      gap={0}
      // The root is the *desktop* copy — always `hidden` below `md` (the mobile
      // mirror renders through `AdaptiveHeaderSlot`). Its page-title `h1` would
      // otherwise duplicate the slot's, so mark it `aria-hidden` on mobile to
      // keep exactly one heading in the accessibility tree even if the
      // responsive `display:none` isn't applied.
      aria-hidden={isMobile || undefined}
      className={cn(
        // Fixed height (not min-h): action clusters (e.g. the settings
        // Save/Discard buttons) would otherwise grow the strip by a pixel
        // and shift the page content whenever they mount/unmount.
        'hidden h-13 shrink-0 px-4 py-2 md:flex',
        standalone && 'bg-background/50 sticky top-0 z-20 backdrop-blur-md',
        showBorder && 'border-border border-b',
        className,
      )}
    >
      {children}
    </HStack>
  );
}

// =============================================================================
// Title Component
// =============================================================================

interface AdaptiveHeaderTitleProps {
  children: ReactNode;
  className?: string;
}

export function AdaptiveHeaderTitle({
  children,
  className,
}: AdaptiveHeaderTitleProps) {
  return (
    <h1
      className={cn(
        'text-foreground truncate text-base font-semibold',
        className,
      )}
    >
      {children}
    </h1>
  );
}
