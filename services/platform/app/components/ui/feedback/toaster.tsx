'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import type { ToastPosition, ToastVariant } from '@tale/ui/toast';
import { cva } from 'class-variance-authority';
import { X, CheckCircle2, XCircle, Info } from 'lucide-react';
import { createPortal } from 'react-dom';

import { useToast } from '@/app/hooks/use-toast';
import { cn } from '@/lib/utils/cn';

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full overflow-hidden rounded-xl p-3 pr-6 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full border bg-background text-foreground',
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
        <CheckCircle2 className="text-success size-5" aria-hidden="true" />
      );
    case 'destructive':
      return <XCircle className="text-destructive size-5" aria-hidden="true" />;
    default:
      return (
        <Info className="text-info-foreground size-5" aria-hidden="true" />
      );
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
              <div className="flex w-full min-w-0 items-start gap-3 pr-4">
                <VariantIcon variant={variant} />
                <div className="grid min-w-0 flex-1 gap-1">
                  {title && (
                    <ToastPrimitives.Title className="text-sm font-semibold">
                      {title}
                    </ToastPrimitives.Title>
                  )}
                  {description && (
                    <ToastPrimitives.Description className="text-sm whitespace-pre-line opacity-90">
                      {description}
                    </ToastPrimitives.Description>
                  )}
                  {/* Stack the action below the text. Putting it inline used
                      to squeeze long titles (e.g. translated update prompts)
                      into a narrow column when the action button's label was
                      wide. */}
                  {action && <div className="mt-2 flex">{action}</div>}
                </div>
              </div>
              <ToastPrimitives.Close
                // Hover-reveal for mouse users; always-visible on coarse
                // (touch) pointers, which have no hover so the toast would
                // otherwise be undismissable until it auto-expires.
                className="text-foreground/50 hover:text-foreground absolute top-2.5 right-2.5 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 focus:opacity-100 focus:ring-2 focus:outline-none group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600 pointer-coarse:opacity-100"
                aria-label="Close"
              >
                <X className="size-4" aria-hidden="true" />
              </ToastPrimitives.Close>
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
                // Product toasts live at the OUTER top-right of the viewport,
                // safe-area aware but not dropped into the app/sheet header band.
                // The viewport already portals to <body> at z-100 above sheets
                // and dialogs, so clickability does not rely on an inward offset.
                // Keep the same 0.75rem outer gutter on every edge.
                'pointer-events-none fixed z-100 flex max-h-screen w-auto max-w-sm min-w-[18.75rem] flex-col p-3 pt-[calc(0.75rem+var(--safe-top))] pr-[calc(0.75rem+var(--safe-right))] pl-[calc(0.75rem+var(--safe-left))]',
                viewportPositionClasses[position],
              )}
            />,
            document.body,
          )}
    </ToastPrimitives.Provider>
  );
}
