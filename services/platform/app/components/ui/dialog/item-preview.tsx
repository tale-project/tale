'use client';

import { cn } from '@/lib/utils/cn';

import { Stack } from '../layout/layout';

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
export function ItemPreview({
  primary,
  secondary,
  className,
}: ItemPreviewProps) {
  return (
    <Stack gap={1} className={cn('bg-secondary/20 rounded-lg p-4', className)}>
      <div className="text-foreground text-sm font-medium">{primary}</div>
      {secondary && (
        <div className="text-muted-foreground text-xs">{secondary}</div>
      )}
    </Stack>
  );
}
