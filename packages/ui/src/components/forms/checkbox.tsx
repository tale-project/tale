import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { cn } from '../../lib/cn';

export const Checkbox = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-base)] shadow-sm transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-[color:var(--color-accent-base)] data-[state=checked]:text-[color:var(--color-accent-fg)] data-[state=checked]:border-[color:var(--color-accent-base)]',
      'data-[state=indeterminate]:bg-[color:var(--color-accent-base)] data-[state=indeterminate]:text-[color:var(--color-accent-fg)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center [&[data-state=checked]_.check]:block [&[data-state=indeterminate]_.minus]:block">
      <Check className="check hidden h-3 w-3" aria-hidden />
      <Minus className="minus hidden h-3 w-3" aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';
