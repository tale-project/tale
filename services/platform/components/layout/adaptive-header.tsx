'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils/cn';
import { HStack } from '@/components/ui/layout';

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

  return (
    <AdaptiveHeaderContext.Provider value={{ headerContent, setHeaderContent }}>
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

  if (!content) return null;

  return (
    <div className={cn('flex items-center flex-1 min-w-0', className)}>
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

  // Register children with context for mobile rendering
  useEffect(() => {
    setHeaderContent(children);
    return () => setHeaderContent(null);
  }, [children, setHeaderContent]);

  return (
    <HStack
      gap={0}
      className={cn(
        'hidden md:flex px-4 py-2 min-h-12 flex-shrink-0',
        standalone && 'sticky top-0 z-50 bg-background/50 backdrop-blur-md',
        showBorder && 'border-b border-border',
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
        'text-base font-semibold text-foreground truncate',
        className,
      )}
    >
      {children}
    </h1>
  );
}
