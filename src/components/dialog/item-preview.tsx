'use client';

import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

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
    <Stack gap={1} className={cn('bg-muted rounded-lg p-4', className)}>
      <Text as="div" variant="label">
        {primary}
      </Text>
      {secondary && (
        <Text as="div" variant="caption">
          {secondary}
        </Text>
      )}
    </Stack>
  );
}
