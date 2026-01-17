'use client';

import { Handle, type HandleProps } from '@xyflow/react';
import { cn } from '@/lib/utils/cn';

/**
 * An invisible ReactFlow Handle that overrides the default handle styling.
 * Used for connecting nodes without showing visible connection points.
 */
export function InvisibleHandle({ className, ...props }: HandleProps) {
  return (
    <Handle
      className={cn('size-2! border-0! bg-transparent! z-10!', className)}
      {...props}
    />
  );
}
