'use client';

import { forwardRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

import { SectionHeader } from './section-header';

interface StickySectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
  size?: 'sm' | 'base' | 'lg';
  weight?: 'semibold' | 'medium';
  action?: ReactNode;
  className?: string;
}

export const StickySectionHeader = forwardRef<
  HTMLDivElement,
  StickySectionHeaderProps
>(({ title, description, as, size, weight, action, className }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-background sticky top-[49px] z-40 -mx-4 flex items-center justify-between px-4 md:top-[97px]',
      className,
    )}
  >
    <SectionHeader
      title={title}
      description={description}
      as={as}
      size={size}
      weight={weight}
      action={action}
    />
  </div>
));
StickySectionHeader.displayName = 'StickySectionHeader';
