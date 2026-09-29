import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Maximum content width. Default `xl` (1280px). */
  size?: 'md' | 'lg' | 'xl' | 'full';
}

const sizeClass: Record<NonNullable<ContainerProps['size']>, string> = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-7xl',
  full: 'max-w-none',
};

export function Container({
  className,
  size = 'xl',
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn('mx-auto w-full px-5 md:px-8', sizeClass[size], className)}
      {...props}
    />
  );
}
