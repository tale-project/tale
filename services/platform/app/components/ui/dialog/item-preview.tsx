'use client';

import { Stack } from '../layout/layout';
import { cn } from '@/lib/utils/cn';

export interface ItemPreviewProps {
  /** Primary text (e.g., item name) */
  primary: string;
  /** Optional secondary text (e.g., item description) */
  secondary?: string;
  /** Additional className */
  className?: string;
}

/**
 * Preview component for showing item details in delete/confirm dialogs.
 */
export function ItemPreview({ primary, secondary, className }: ItemPreviewProps) {
  return (
    <Stack gap={1} className={cn('bg-secondary/20 rounded-lg p-4', className)}>
      <div className="text-sm font-medium text-foreground">{primary}</div>
      {secondary && (
        <div className="text-xs text-muted-foreground">{secondary}</div>
      )}
    </Stack>
  );
}
