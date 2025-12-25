'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef, ComponentRef, ComponentPropsWithoutRef, useId } from 'react';

import { cn } from '@/lib/utils/cn';
import { Label } from './label';

interface SwitchProps
  extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label?: string;
}

const Switch = forwardRef<ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, label, required, id: providedId, ...props }, ref) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;

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

    if (!label) {
      return switchElement;
    }

    return (
      <div className="flex items-center gap-2">
        {switchElement}
        <Label htmlFor={id} required={required} className="cursor-pointer">
          {label}
        </Label>
      </div>
    );
  }
);
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
