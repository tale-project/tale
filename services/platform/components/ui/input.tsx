'use client';

import { InputHTMLAttributes, forwardRef, useState } from 'react';
import { Eye, EyeOff, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  passwordToggle?: boolean;
  errorMessage?: string;
  size?: 'default' | 'sm' | 'lg';
};

const Input = forwardRef<HTMLInputElement, BaseProps>(
  (
    {
      className,
      type,
      passwordToggle = true,
      autoComplete,
      size = 'default',
      errorMessage,
      ...props
    },
    ref,
  ) => {
    const isPassword = type === 'password';
    const [show, setShow] = useState(false);
    const inputType = isPassword ? (show ? 'text' : 'password') : type;
    const resolvedAutoComplete =
      autoComplete ?? (isPassword ? 'current-password' : undefined);
    const hasError = !!errorMessage;

    const inputClassName = cn(
      hasError
        ? 'border-destructive focus-visible:ring-destructive'
        : 'border-border',
      className,
    );

    if (isPassword && passwordToggle) {
      return (
        <>
          <div className="relative">
            <input
              type={inputType}
              autoComplete={resolvedAutoComplete}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                size === 'default' && 'h-9',
                size === 'sm' && 'h-8',
                size === 'lg' && 'h-10',
                inputClassName,
              )}
              ref={ref}
              {...props}
            />
            <button
              type="button"
              aria-label={show ? 'Hide password' : 'Show password'}
              aria-pressed={show}
              className="absolute inset-y-0 right-2 my-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => setShow((v) => !v)}
            >
              {show ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          {errorMessage && (
            <p className="text-sm text-destructive flex items-center gap-1.5 mt-2">
              <XCircle className="size-4" />
              {errorMessage}
            </p>
          )}
        </>
      );
    }

    return (
      <>
        <input
          type={type}
          autoComplete={resolvedAutoComplete}
          className={cn(
            'flex w-full rounded-md ring-1 ring-border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:ring-primary',
            size === 'default' && 'h-9',
            size === 'sm' && 'h-8',
            size === 'lg' && 'h-10',
            inputClassName,
          )}
          ref={ref}
          {...props}
        />
        {errorMessage && (
          <p className="text-sm text-destructive flex items-center gap-1.5 mt-2">
            <Info className="size-4" />
            {errorMessage}
          </p>
        )}
      </>
    );
  },
);
Input.displayName = 'Input';

export { Input };
