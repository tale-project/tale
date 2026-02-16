'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva } from 'class-variance-authority';
import { X, CheckCircle2, XCircle } from 'lucide-react';

import { useToast } from '@/app/hooks/use-toast';
import { cn } from '@/lib/utils/cn';

import type { ToastVariant } from './toast';

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-xl p-3 pr-6 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full border bg-background text-foreground',
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
      return null;
  }
}

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastPrimitives.Provider>
      {toasts.map(
        ({ id, title, description, action, variant, className, ...props }) => {
          const icon = <VariantIcon variant={variant} />;
          const hasIcon = variant === 'success' || variant === 'destructive';

          return (
            <ToastPrimitives.Root
              key={id}
              className={cn(toastVariants({ variant }), className)}
              {...props}
            >
              {hasIcon ? (
                <div className="flex items-start space-x-3">
                  {icon}
                  <div className="flex-1 pr-4">
                    <div className="grid gap-1">
                      {title && (
                        <ToastPrimitives.Title className="text-sm font-semibold">
                          {title}
                        </ToastPrimitives.Title>
                      )}
                      {description && (
                        <ToastPrimitives.Description className="text-sm opacity-90">
                          {description}
                        </ToastPrimitives.Description>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-1">
                  {title && (
                    <ToastPrimitives.Title className="text-sm font-semibold">
                      {title}
                    </ToastPrimitives.Title>
                  )}
                  {description && (
                    <ToastPrimitives.Description className="text-sm opacity-90">
                      {description}
                    </ToastPrimitives.Description>
                  )}
                </div>
              )}
              {action}
              <ToastPrimitives.Close
                className="text-foreground/50 hover:text-foreground absolute top-2.5 right-2.5 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 focus:opacity-100 focus:ring-2 focus:outline-none group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600"
                aria-label="Close"
              >
                <X className="size-4" aria-hidden="true" />
              </ToastPrimitives.Close>
            </ToastPrimitives.Root>
          );
        },
      )}
      <ToastPrimitives.Viewport className="fixed top-0 z-100 flex max-h-screen w-auto max-w-md min-w-[18.75rem] flex-col-reverse p-3 sm:top-auto sm:bottom-0 sm:left-1/2 sm:-translate-x-1/2 sm:flex-col" />
    </ToastPrimitives.Provider>
  );
}
