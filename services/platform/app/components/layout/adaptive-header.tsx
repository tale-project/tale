'use client';

import { HStack } from '@tale/ui/layout';
import {
  createContext,
  useCallback,
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
  /** Desktop-only mount points for page chrome that must sit in this strip
   * (run/save cluster, pack description, identity next to the title) rather
   * than on a second row. */
  actionsEl: HTMLElement | null;
  descriptionEl: HTMLElement | null;
  identityElDesktop: HTMLElement | null;
  identityElMobile: HTMLElement | null;
  setActionsEl: (el: HTMLElement | null) => void;
  setDescriptionEl: (el: HTMLElement | null) => void;
  setIdentityElDesktop: (el: HTMLElement | null) => void;
  setIdentityElMobile: (el: HTMLElement | null) => void;
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

/** Slots the header exposes so a page can portal chrome into the title
 * strip. `null` outside the provider — the page then renders those pieces
 * itself. Identity sits next to the title on both breakpoints (desktop root
 * vs mobile slot); actions and description stay desktop-only portals. */
export function useAdaptiveHeaderSlots(): {
  actionsEl: HTMLElement | null;
  descriptionEl: HTMLElement | null;
  identityElDesktop: HTMLElement | null;
  identityElMobile: HTMLElement | null;
} | null {
  const context = useContext(AdaptiveHeaderContext);
  if (!context) return null;
  return {
    actionsEl: context.actionsEl,
    descriptionEl: context.descriptionEl,
    identityElDesktop: context.identityElDesktop,
    identityElMobile: context.identityElMobile,
  };
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
  const [actionsEl, setActionsElState] = useState<HTMLElement | null>(null);
  const [descriptionEl, setDescriptionElState] = useState<HTMLElement | null>(
    null,
  );
  const [identityElDesktop, setIdentityElDesktopState] =
    useState<HTMLElement | null>(null);
  const [identityElMobile, setIdentityElMobileState] =
    useState<HTMLElement | null>(null);
  const setActionsEl = useCallback((el: HTMLElement | null) => {
    setActionsElState((current) => (current === el ? current : el));
  }, []);
  const setDescriptionEl = useCallback((el: HTMLElement | null) => {
    setDescriptionElState((current) => (current === el ? current : el));
  }, []);
  const setIdentityElDesktop = useCallback((el: HTMLElement | null) => {
    setIdentityElDesktopState((current) => (current === el ? current : el));
  }, []);
  const setIdentityElMobile = useCallback((el: HTMLElement | null) => {
    setIdentityElMobileState((current) => (current === el ? current : el));
  }, []);

  const value = useMemo(
    () => ({
      headerContent,
      setHeaderContent,
      actionsEl,
      descriptionEl,
      identityElDesktop,
      identityElMobile,
      setActionsEl,
      setDescriptionEl,
      setIdentityElDesktop,
      setIdentityElMobile,
    }),
    [
      headerContent,
      actionsEl,
      descriptionEl,
      identityElDesktop,
      identityElMobile,
      setActionsEl,
      setDescriptionEl,
      setIdentityElDesktop,
      setIdentityElMobile,
    ],
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
  const { setIdentityElMobile } = useAdaptiveHeader();
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
      className={cn('flex min-w-0 flex-1 items-center gap-2', className)}
    >
      <div className="min-w-0 flex-1">{content}</div>
      <div
        ref={setIdentityElMobile}
        className="flex shrink-0 items-center gap-2 empty:hidden"
      />
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
   * Draws the section divider under the title row. Every section header ends
   * in exactly one `border-border` line: a tab strip immediately below the
   * row carries its own `border-b` (Knowledge, Inbox, project detail), so
   * those headers omit this; every other header passes it.
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
  const {
    setHeaderContent,
    setActionsEl,
    setDescriptionEl,
    setIdentityElDesktop,
  } = useAdaptiveHeader();
  const isMobile = useIsMobile();

  // Register children with context for mobile rendering
  useEffect(() => {
    setHeaderContent(children);
    return () => setHeaderContent(null);
  }, [children, setHeaderContent]);

  return (
    <div
      // The root is the *desktop* copy — always `hidden` below `md` (the mobile
      // mirror renders through `AdaptiveHeaderSlot`). Its page-title `h1` would
      // otherwise duplicate the slot's, so mark it `aria-hidden` on mobile to
      // keep exactly one heading in the accessibility tree even if the
      // responsive `display:none` isn't applied.
      aria-hidden={isMobile || undefined}
      className={cn(
        'hidden w-full shrink-0 md:flex md:flex-col',
        standalone && 'bg-background/50 sticky top-0 z-20 backdrop-blur-md',
        showBorder && 'border-border border-b',
      )}
    >
      <HStack
        gap={0}
        className={cn(
          // Fixed height on the TITLE row (not min-h): action clusters
          // (e.g. the settings Save/Discard buttons) would otherwise grow the
          // strip by a pixel and shift the page content whenever they
          // mount/unmount. A description, when a page portals one, sits on
          // the row below and is allowed to add height.
          'h-13 px-4 py-2',
          className,
        )}
      >
        <div className="min-w-0">{children}</div>
        <div
          ref={setIdentityElDesktop}
          className="flex shrink-0 items-center gap-2 empty:hidden"
        />
        <div
          ref={setActionsEl}
          className="ml-auto flex min-w-0 items-center justify-end empty:hidden"
        />
      </HStack>
      <div
        ref={setDescriptionEl}
        className="max-w-prose px-4 pb-2.5 empty:hidden"
      />
    </div>
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
