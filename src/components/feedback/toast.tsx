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
