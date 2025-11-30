'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, onCheckedChange, checked, ...rest }, ref) => {
  const mappedState =
    checked === undefined
      ? undefined
      : checked === 'indeterminate'
        ? 'indeterminate'
        : checked
          ? 'checked'
          : 'unchecked';

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-border ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white data-[state=indeterminate]:text-white data-[state=indeterminate]:bg-blue-600 data-[state=indeterminate]:border-blue-600 bg-background',
        className,
      )}
      onCheckedChange={onCheckedChange}
      {...rest}
      checked={checked}
      data-state={mappedState}
    >
      <CheckboxPrimitive.Indicator
        className={cn(
          'flex items-center justify-center text-current pt-[0.025rem]',
        )}
      >
        {checked === 'indeterminate' ? (
          <Minus className="size-[0.875rem]" strokeWidth={3} />
        ) : (
          <Check className="size-[0.875rem]" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
