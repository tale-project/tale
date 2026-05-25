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

const sheetVariants = cva(
  'fixed z-50 gap-4 overflow-y-auto bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 h-full sm:h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 h-full sm:h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full w-full sm:w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
        right:
          'inset-y-0 right-0 h-full w-full sm:w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
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
          className={cn(sheetVariants({ side, size }), widthClass, className)}
          style={widthStyle}
          onOpenAutoFocus={onOpenAutoFocus}
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
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none"
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
