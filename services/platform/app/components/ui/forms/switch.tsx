'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
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

interface SwitchProps extends ComponentPropsWithoutRef<
  typeof SwitchPrimitive.Root
> {
  label?: string;
  description?: ReactNode;
}

export const Switch = forwardRef<
  ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(
  (
    { className, label, description, required, id: providedId, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const descriptionId = `${id}-description`;

    const switchElement = (
      <SwitchPrimitive.Root
        ref={ref}
        id={id}
        data-slot="switch"
        className={cn(
          'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        required={required}
        aria-describedby={description ? descriptionId : undefined}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
          )}
        />
      </SwitchPrimitive.Root>
    );

    if (!label && !description) {
      return switchElement;
    }

    if (description) {
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            {label && (
              <Label
                htmlFor={id}
                required={required}
                className="cursor-pointer"
              >
                {label}
              </Label>
            )}
            {switchElement}
          </div>
          <Description id={descriptionId} className="text-xs">
            {description}
          </Description>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} required={required} className="cursor-pointer">
          {label}
        </Label>
        {switchElement}
      </div>
    );
  },
);
Switch.displayName = SwitchPrimitive.Root.displayName;
