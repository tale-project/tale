'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import type { ToastPosition, ToastVariant } from '@tale/ui/toast';
import { cva } from 'class-variance-authority';
import { CheckCircle2, XCircle } from 'lucide-react';
import { createPortal } from 'react-dom';

import { useToast } from '@/app/hooks/use-toast';
import { cn } from '@/lib/utils/cn';

const toastVariants = cva(
  // shadcn-style: one horizontal row, items-center, equal padding. Action sits
  // beside the copy (not under it). No close control — toasts auto-dismiss
  // (and pause on hover/focus); swipe still dismisses.
  'group data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full bg-background text-foreground pointer-events-auto relative flex w-fit max-w-sm items-center gap-3 overflow-hidden rounded-xl border p-4 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none',
  {
    variants: {
      variant: {
        default: '',
        success: '',
        destructive: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function VariantIcon({ variant }: { variant?: ToastVariant }) {
  switch (variant) {
    case 'success':
      return (
        <CheckCircle2
          className="text-success size-5 shrink-0"
          aria-hidden="true"
        />
      );
    case 'destructive':
      return (
        <XCircle
          className="text-destructive size-5 shrink-0"
          aria-hidden="true"
        />
      );
    default:
      // Default / action toasts match shadcn: copy only, no leading info icon.
      return null;
  }
}

const viewportPositionClasses: Record<ToastPosition, string> = {
  'top-right': 'top-0 right-0',
  'top-center': 'top-0 left-1/2 -translate-x-1/2',
};

export function Toaster() {
  const { toasts } = useToast();
  const position: ToastPosition = toasts[0]?.position ?? 'top-right';

  // 5s auto-dismiss: long enough to read a title + description without rushing
  // (WCAG 2.2.1 favours generous timing), while Radix pauses the timer on
  // hover/focus and when the window loses focus so slower readers can still
  // finish. The prior 3.5s was tight enough that even 5s test waits and human
  // readers routinely missed save/copy/delete toasts.
  return (
    <ToastPrimitives.Provider duration={5000}>
      {toasts.map(
        ({
          id,
          title,
          description,
          action,
          variant,
          className,
          position: _position,
          ...props
        }) => {
          return (
            <ToastPrimitives.Root
              key={id}
              className={cn(toastVariants({ variant }), className)}
              {...props}
            >
              <VariantIcon variant={variant} />
              <div className="grid min-w-0 flex-1 gap-1">
                {title && (
                  <ToastPrimitives.Title className="text-sm font-semibold">
                    {title}
                  </ToastPrimitives.Title>
                )}
                {description && (
                  <ToastPrimitives.Description className="text-muted-foreground text-sm whitespace-pre-line">
                    {description}
                  </ToastPrimitives.Description>
                )}
              </div>
              {action}
            </ToastPrimitives.Root>
          );
        },
      )}
      {/* Portal the viewport to `document.body` so it shares the root
          stacking context with Radix Dialog/Sheet portals (which also mount
          on `body`). Rendered inline, the viewport is trapped in whatever
          stacking context an ancestor creates, so an open modal Sheet —
          portaled to `body` and painted later in DOM order — covers the
          toast even though the toast's `z-100` is numerically above the
          Sheet's `z-50`. The toast then looks visible but its actions can't
          be clicked (e.g. the "update available" prompt while a settings
          panel is open). On `body`, `z-100 > z-50` wins for real. The toast
          rows keep `pointer-events-auto`, so they stay interactive even while
          the modal locks `body { pointer-events: none }`. */}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <ToastPrimitives.Viewport
              className={cn(
                // `pointer-events-none` on the viewport so its empty padding/gap
                // area never intercepts clicks meant for the controls beneath it
                // (e.g. the top-right "Create agent" button / the Save bar). Each
                // toast Root re-enables `pointer-events-auto`, so toasts stay
                // interactive (close / swipe) while the gaps click through.
                //
                // The stack tucks into the top-right corner with a SYMMETRIC
                // inset: the top gap equals the right gap (0.75rem plus the
                // safe-area inset on each axis), so the first toast sits the same
                // distance from the top edge as from the right. The padding lives
                // INSIDE the `top-0`/`max-h-screen` box, so the stack still fits
                // the viewport, and the empty gap stays `pointer-events-none`
                // (controls beneath it remain clickable).
                'pointer-events-none fixed z-100 flex max-h-screen w-auto max-w-sm flex-col p-3 pt-[calc(0.75rem+var(--safe-top))] pr-[calc(0.75rem+var(--safe-right))] pl-[calc(0.75rem+var(--safe-left))]',
                viewportPositionClasses[position],
              )}
            />,
            document.body,
          )}
    </ToastPrimitives.Provider>
  );
}
