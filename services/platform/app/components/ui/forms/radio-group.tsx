'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Circle } from 'lucide-react';
import {
  forwardRef,
  ComponentRef,
  ComponentPropsWithoutRef,
  ReactNode,
  useId,
} from 'react';

import { cn } from '@/lib/utils/cn';

import { Description } from './description';
import { Label } from './label';

interface RadioGroupProps extends ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Root
> {
  label?: string;
  description?: ReactNode;
}

export const RadioGroup = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(
  (
    { className, label, description, required, id: providedId, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const descriptionId = `${id}-description`;

    return (
      <div className="flex flex-col gap-2">
        {label && (
          <Label id={`${id}-label`} required={required}>
            {label}
          </Label>
        )}
        {description && (
          <Description id={descriptionId} className="text-xs">
            {description}
          </Description>
        )}
        <RadioGroupPrimitive.Root
          className={cn('grid gap-2', className)}
          {...props}
          ref={ref}
          required={required}
          aria-labelledby={label ? `${id}-label` : undefined}
          aria-describedby={description ? descriptionId : undefined}
        />
      </div>
    );
  },
);
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

interface RadioGroupItemProps extends ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Item
> {
  label?: string;
}

export const RadioGroupItem = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, label, id: providedId, ...props }, ref) => {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  const radio = (
    <RadioGroupPrimitive.Item
      ref={ref}
      id={id}
      className={cn(
        'aspect-square size-4 rounded-full border border-primary data-[state=checked]:border-blue-600 text-blue-600 ring-offset-background transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle
          className="h-2.5 w-2.5 fill-current text-current"
          aria-hidden="true"
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );

  if (!label) {
    return radio;
  }

  return (
    <div className="flex items-center gap-2">
      {radio}
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;
