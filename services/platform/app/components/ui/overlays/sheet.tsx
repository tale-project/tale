'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { IconButton } from '@tale/ui/icon-button';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { useResizable } from '@/app/hooks/use-resizable';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// Safe-area padding is layered into the design `p-6` via per-edge calc() so
// the panel's content clears the iOS notch / home indicator / rounded corners
// in standalone PWAs. `env(safe-area-inset-*)` resolves to 0 on browsers
// without `viewport-fit=cover`, leaving a flat 1.5rem on desktop.
//
// The base only applies safe-area padding to the two axes that always touch a
// viewport edge for ANY sheet variant (left + right). The cross-axis padding
// is applied per `side`: only the edges where the panel actually meets a
// viewport boundary get the inset. A `side="bottom"` sheet, for example, does
// not abut the status bar, so adding `--safe-top` there is wasted space — in
// mobile Safari (non-standalone) it shows up as a noticeable ~50px gap at the
// top of the sheet content.
//
// Consumers that pass `p-0` (custom layouts that manage their own padding)
// will twMerge-strip these per-side rules — those layouts must apply
// `pt-(--safe-top)` etc. on their own inner content. The chat-history
// sidebar and settings drawer panels follow that pattern.
const sheetVariants = cva(
  // `focus:outline-none`: Radix parks focus on the panel container when it
  // opens (so keyboard/SR users land inside the dialog). The container is not
  // an interactive control, so the browser's default focus outline reads as a
  // stray blue ring around the whole panel — suppress it. Focusable controls
  // inside the panel keep their own `focus-visible` rings.
  'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 gap-4 overflow-y-auto p-6 pr-[calc(1.5rem+var(--safe-right))] pl-[calc(1.5rem+var(--safe-left))] shadow-lg transition ease-in-out focus:outline-none data-[state=closed]:duration-300 data-[state=open]:duration-500',
  {
    variants: {
      side: {
        top: 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-full border-b pt-[calc(1.5rem+var(--safe-top))] sm:h-auto',
        bottom:
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-full border-t pb-[calc(1.5rem+var(--safe-bottom))] sm:h-auto',
        // Side borders only from `sm` up — below that the panel is `w-full` and
        // an edge border against the viewport reads as a stray hairline.
        left: 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-full pt-[calc(1.5rem+var(--safe-top))] pb-[calc(1.5rem+var(--safe-bottom))] sm:w-3/4 sm:max-w-sm sm:border-r',
        right:
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-full pt-[calc(1.5rem+var(--safe-top))] pb-[calc(1.5rem+var(--safe-bottom))] sm:w-3/4 sm:max-w-sm sm:border-l',
      },
      size: {
        sm: '',
        md: 'sm:max-w-[26rem]',
        xl: 'sm:max-w-[64rem]',
      },
    },
    defaultVariants: {
      side: 'right',
      size: 'sm',
    },
  },
);

type SheetSize = 'sm' | 'md' | 'xl';

interface SheetResizeOptions {
  /** Initial width in px. Defaults to a width derived from the `size` variant. */
  defaultWidthPx?: number;
  /** Minimum width in px the user can drag to. Defaults to 320. */
  minWidthPx?: number;
  /** Maximum width in px the user can drag to. Defaults to 1400. */
  maxWidthPx?: number;
  /** When set, persists the user's chosen width in localStorage under this key. */
  storageKey?: string;
}

interface SheetProps extends VariantProps<typeof sheetVariants> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (rendered as screen-reader only) */
  title: string;
  /** Accessible description (rendered as screen-reader only) */
  description?: string;
  children: ReactNode;
  className?: string;
  hideClose?: boolean;
  /** Width of the sheet panel */
  size?: SheetSize;
  /**
   * Drag-to-resize behavior. Default-on for `side="right"`. Pass `false`
   * to disable, or an options object to tune width range / persistence.
   * Resize is silently a no-op on `side !== 'right'` (the hook's geometry
   * assumes a right-anchored panel).
   */
  resize?: false | SheetResizeOptions;
  /**
   * Called when focus moves into the sheet on open. Call `event.preventDefault()`
   * to suppress Radix's default (focus first tabbable inside Content) and take
   * over focus management — useful to avoid races with `autoFocus` + slide-in
   * animation.
   */
  onOpenAutoFocus?: (event: Event) => void;
}

const SheetCloseButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'>
>(({ className, ...props }, ref) => {
  const { t } = useT('common');
  return (
    <IconButton
      ref={ref}
      icon={X}
      aria-label={t('aria.close')}
      className={cn(className)}
      {...props}
    />
  );
});
SheetCloseButton.displayName = 'SheetCloseButton';

const SIZE_TO_DEFAULT_WIDTH_PX: Record<SheetSize, number> = {
  sm: 384, // 24rem — matches `sm:max-w-sm` from the right side variant
  md: 416, // 26rem
  xl: 1024, // 64rem
};
const DEFAULT_MIN_WIDTH_PX = 320;
const DEFAULT_MAX_WIDTH_PX = 1400;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStoredWidth(
  storageKey: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!storageKey || typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  size = 'sm',
  resize,
  children,
  className,
  hideClose,
  onOpenAutoFocus,
}: SheetProps) {
  const { t: tCommon } = useT('common');

  // Resize is meaningful only for side="right" (the hook geometry assumes
  // a right-anchored panel). Anything else falls through to the size
  // variant's static width.
  const effectiveResize = side === 'right' && resize !== false;
  const resizeOpts: SheetResizeOptions =
    typeof resize === 'object' && resize !== null ? resize : {};
  const minWidthPx = resizeOpts.minWidthPx ?? DEFAULT_MIN_WIDTH_PX;
  const maxWidthPx = resizeOpts.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX;
  const fallbackWidth = clamp(
    resizeOpts.defaultWidthPx ?? SIZE_TO_DEFAULT_WIDTH_PX[size],
    minWidthPx,
    maxWidthPx,
  );
  const storageKey = resizeOpts.storageKey;

  const panelRef = useRef<HTMLDivElement>(null);
  const [storedWidth, setStoredWidth] = useState(() =>
    readStoredWidth(storageKey, fallbackWidth, minWidthPx, maxWidthPx),
  );
  const { width, minWidth, maxWidth, handleMouseDown, handleKeyDown } =
    useResizable(panelRef, {
      minWidth: minWidthPx,
      maxWidth: maxWidthPx,
      width: storedWidth,
      onWidthChange: setStoredWidth,
    });

  useEffect(() => {
    if (!effectiveResize || !storageKey || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(storageKey, String(width));
  }, [effectiveResize, storageKey, width]);

  const widthClass = effectiveResize
    ? 'sm:w-[var(--sheet-w)] sm:max-w-[var(--sheet-w)]'
    : undefined;
  const widthStyle = effectiveResize
    ? ({ '--sheet-w': `${width}px` } as CSSProperties)
    : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80" />
        <DialogPrimitive.Content
          aria-modal="true"
          className={cn(sheetVariants({ side, size }), widthClass, className)}
          style={widthStyle}
          onOpenAutoFocus={onOpenAutoFocus}
          // Without a description, opt out of Radix's default
          // `aria-describedby` (which would otherwise point at a
          // `Description` id that is never rendered — a dangling ARIA
          // reference Radix warns about in dev). Mirrors the `Dialog`
          // primitive's handling in `dialog.tsx`.
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="sr-only">
              {description}
            </DialogPrimitive.Description>
          )}
          {effectiveResize && (
            <>
              {/* Sentinel anchored to the panel's right edge — useResizable
                  reads its bounding rect to compute width from the cursor X. */}
              <div
                ref={panelRef}
                aria-hidden
                className="pointer-events-none absolute inset-0"
              />
              {/* Drag handle on the left edge. The 8px outer wrapper extends
                  the hit area; the cursor target sits visually on the border. */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={tCommon('aria.resizePanel')}
                tabIndex={0}
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
                aria-valuemin={minWidth}
                aria-valuemax={maxWidth}
                aria-valuenow={width}
                className="hover:bg-border focus-visible:ring-ring absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize transition-colors focus-visible:ring-2 sm:block"
              />
            </>
          )}
          {children}
          {!hideClose && (
            <DialogPrimitive.Close
              className={cn(
                'ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed',
                // Only add safe-area offsets on the edges this side abuts —
                // matches the per-side padding logic in `sheetVariants`.
                side === 'bottom'
                  ? 'top-4 right-[calc(1rem+var(--safe-right))]'
                  : side === 'left'
                    ? 'top-[calc(1rem+var(--safe-top))] right-4'
                    : 'top-[calc(1rem+var(--safe-top))] right-[calc(1rem+var(--safe-right))]',
              )}
              asChild
            >
              <SheetCloseButton />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
