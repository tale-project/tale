import type { ReactElement } from 'react';

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive';
export type ToastPosition = 'top-right' | 'top-center';

export interface ToastProps {
  variant?: ToastVariant;
  position?: ToastPosition;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
}

export type ToastActionElement = ReactElement;

// Multiple actions share a full-width row below the copy. Wrap the controls
// and their labels when a narrow viewport or larger text needs more room.
export const toastActionGroupClassName =
  'flex w-full min-w-0 flex-wrap items-center justify-end gap-2 [&>button]:h-auto [&>button]:min-h-8 [&>button]:max-w-full [&>button]:py-1 [&>button]:whitespace-normal';
