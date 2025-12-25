'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';

export interface ViewModalProps {
  /** Whether the modal is open */
  open?: boolean;
  /** Callback when the modal open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Modal title */
  title: string;
  /** Optional description below the title */
  description?: React.ReactNode;
  /** Modal content */
  children: React.ReactNode;
  /** Additional className for DialogContent */
  className?: string;
  /** Hide the close button */
  hideClose?: boolean;
  /** Custom footer content */
  customFooter?: React.ReactNode;
}

/**
 * View modal for displaying read-only content.
 * Use this for viewing details, information, or content that doesn't require user action.
 */
export function ViewModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideClose = false,
  customFooter,
}: ViewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[90vh] overflow-y-auto', className)} hideClose={hideClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        {customFooter && <DialogFooter>{customFooter}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
