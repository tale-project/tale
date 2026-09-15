import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Vertical padding scale. Default `md`. */
  spacing?: 'sm' | 'md' | 'lg';
  /** Section background tone. */
  tone?: 'default' | 'muted' | 'inverse';
}

const spacingClass: Record<NonNullable<SectionProps['spacing']>, string> = {
  sm: 'py-12 md:py-16',
  md: 'py-20 md:py-28',
  lg: 'py-28 md:py-36',
};

const toneClass: Record<NonNullable<SectionProps['tone']>, string> = {
  default: 'bg-[color:var(--color-bg-base)] text-[color:var(--color-fg-base)]',
  muted:
    'bg-[color:var(--color-bg-elevated)] text-[color:var(--color-fg-base)]',
  inverse:
    'bg-[color:var(--color-accent-base)] text-[color:var(--color-accent-fg)]',
};

export function Section({
  className,
  spacing = 'md',
  tone = 'default',
  ...props
}: SectionProps) {
  return (
    <section
      className={cn(spacingClass[spacing], toneClass[tone], className)}
      {...props}
    />
  );
}
