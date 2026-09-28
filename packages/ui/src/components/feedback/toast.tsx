import type { ReactElement } from 'react';

export type ToastVariant = 'default' | 'success' | 'destructive';
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

// A toast row assumes its action is ONE short control that always fits
// beside the copy — true for a single button, false the moment an action
// holds two (e.g. "Later" + a primary). That squeeze isn't a viewport thing:
// the toast's width is fixed (`max-w-sm`), not responsive, so any
// sufficiently long title/description crowds a multi-button action at any
// screen size. Mark such a group with this class to drop it onto its own
// right-aligned line below the copy instead (pairs with toaster.tsx's
// `flex-wrap`).
export const toastActionGroupClassName =
  'border-border flex w-full items-center justify-end gap-2 border-t pt-2';
