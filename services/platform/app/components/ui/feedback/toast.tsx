import type { ReactElement } from 'react';

export type ToastVariant = 'default' | 'success' | 'destructive';

export interface ToastProps {
  variant?: ToastVariant;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export type ToastActionElement = ReactElement;
