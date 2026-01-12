'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { Label } from './label';

interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: string;
  required?: boolean;
}

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, onCheckedChange, checked, label, required, id: providedId, ...rest }, ref) => {
  const generatedId = React.useId();
  const id = providedId ?? generatedId;
  const mappedState =
    checked === undefined
      ? undefined
      : checked === 'indeterminate'
        ? 'indeterminate'
        : checked
          ? 'checked'
          : 'unchecked';

  const checkbox = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={id}
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-border ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white data-[state=indeterminate]:text-white data-[state=indeterminate]:bg-blue-600 data-[state=indeterminate]:border-blue-600 bg-background transition-colors duration-150',
        className,
      )}
      onCheckedChange={onCheckedChange}
      {...rest}
      checked={checked}
      data-state={mappedState}
      required={required}
    >
      <CheckboxPrimitive.Indicator
        className={cn(
          'flex items-center justify-center text-current pt-[0.025rem]',
        )}
      >
        {checked === 'indeterminate' ? (
          <Minus className="size-[0.875rem]" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-[0.875rem]" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) {
    return checkbox;
  }

  return (
    <div className="flex items-center gap-2">
      {checkbox}
      <Label htmlFor={id} required={required} className="cursor-pointer">
        {label}
      </Label>
    </div>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

