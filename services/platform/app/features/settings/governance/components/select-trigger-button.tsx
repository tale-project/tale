import { type ButtonHTMLAttributes, forwardRef } from 'react';

interface SelectTriggerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  hasValue: boolean;
}

export const SelectTriggerButton = forwardRef<
  HTMLButtonElement,
  SelectTriggerButtonProps
>(function SelectTriggerButton({ hasValue, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className="ring-1 ring-border bg-input flex h-8 w-full items-center justify-between rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={hasValue ? '' : 'text-muted-foreground'}>
        {children}
      </span>
    </button>
  );
});
