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

export interface RadioGroupOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface RadioGroupProps extends ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Root
> {
  label?: string;
  description?: ReactNode;
  options?: RadioGroupOption[];
}

export const RadioGroup = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(
  (
    {
      className,
      label,
      description,
      required,
      id: providedId,
      options,
      children,
      ...props
    },
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
        >
          {options
            ? options.map((option) => (
                <RadioGroupItem
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                />
              ))
            : children}
        </RadioGroupPrimitive.Root>
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
    <label className="flex cursor-pointer items-center gap-2">
      {radio}
      <span className="text-xs leading-none font-normal md:text-sm">
        {label}
      </span>
    </label>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;
