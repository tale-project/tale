'use client';

import { InputHTMLAttributes, forwardRef, useState, useId } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Eye, EyeOff, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n';
import { Label } from './label';

const inputVariants = cva(
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-9',
        sm: 'h-8',
        lg: 'h-10',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> &
  VariantProps<typeof inputVariants> & {
    passwordToggle?: boolean;
    errorMessage?: string;
    label?: string;
    required?: boolean;
  };

const Input = forwardRef<HTMLInputElement, BaseProps>(
  (
    {
      className,
      type,
      passwordToggle = true,
      autoComplete,
      size,
      errorMessage,
      label,
      required,
      id: providedId,
      ...props
    },
    ref
  ) => {
    const { t } = useT('common');
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const isPassword = type === 'password';
    const [show, setShow] = useState(false);
    const inputType = isPassword ? (show ? 'text' : 'password') : type;
    const resolvedAutoComplete =
      autoComplete ?? (isPassword ? 'current-password' : undefined);
    const hasError = !!errorMessage;

    const errorClassName = hasError
      ? 'border-destructive focus-visible:ring-destructive'
      : 'border-border';

    if (isPassword && passwordToggle) {
      return (
        <div className="flex flex-col gap-1.5">
          {label && (
            <Label htmlFor={id} required={required} error={hasError}>
              {label}
            </Label>
          )}
          <div className="relative">
            <input
              id={id}
              type={inputType}
              autoComplete={resolvedAutoComplete}
              className={cn(
                inputVariants({ size }),
                'pr-10',
                errorClassName,
                className
              )}
              ref={ref}
              required={required}
              aria-invalid={hasError}
              {...props}
            />
            <button
              type="button"
              aria-label={show ? t('aria.hidePassword') : t('aria.showPassword')}
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
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <XCircle className="size-4" />
              {errorMessage}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <Label htmlFor={id} required={required} error={hasError}>
            {label}
          </Label>
        )}
        <input
          id={id}
          type={type}
          autoComplete={resolvedAutoComplete}
          className={cn(
            inputVariants({ size }),
            'ring-1 ring-border focus-visible:ring-primary',
            errorClassName,
            className
          )}
          ref={ref}
          required={required}
          aria-invalid={hasError}
          {...props}
        />
        {errorMessage && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <Info className="size-4" />
            {errorMessage}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input, inputVariants };
