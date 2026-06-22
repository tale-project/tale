'use client';

import { Card } from '@tale/ui/card';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * The shared frame for every in-chat approval / request / control card
 * (document writes, integration ops, workflow run/create/update, plans, human
 * input/control/location). One `rounded-xl` `@tale/ui/card` surface so they all
 * stay visually identical — replaces the per-card hand-rolled
 * `rounded-xl border border-border p-4 bg-card …` divs.
 */
const MAX_WIDTH = {
  md: 'max-w-md',
  xl: 'w-full max-w-xl',
  '2xl': 'w-full max-w-2xl',
} as const;

interface ApprovalCardProps {
  /** Width cap. `md` is the default approval card; `xl`/`2xl` are the wider ones. */
  maxWidth?: keyof typeof MAX_WIDTH;
  /** Inner padding — `md` (p-4) for most, `lg` (p-5) for the request cards. */
  padding?: 'md' | 'lg';
  className?: string;
  children: ReactNode;
}

export function ApprovalCard({
  maxWidth = 'md',
  padding = 'md',
  className,
  children,
}: ApprovalCardProps) {
  return (
    <Card
      radius="xl"
      padding={padding}
      className={cn('overflow-hidden', MAX_WIDTH[maxWidth], className)}
    >
      {children}
    </Card>
  );
}
