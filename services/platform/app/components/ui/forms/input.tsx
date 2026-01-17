'use client';

import {
  InputHTMLAttributes,
  forwardRef,
  useState,
  useId,
  useEffect,
} from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Eye, EyeOff, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';
import { Label } from './label';

const inputVariants = cva(
  'flex w-full text-base file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-[border-color,box-shadow] duration-150',
  {
    variants: {
      variant: {
        default:
          'rounded-lg border border-transparent bg-background px-3 py-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-1 ring-border focus-visible:ring-primary',
        unstyled: 'bg-transparent border-0 ring-0 ring-offset-0',
      },
      size: {
        default: 'h-9',
        sm: 'h-8',
        lg: 'h-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> &
  VariantProps<typeof inputVariants> & {
    passwordToggle?: boolean;
    errorMessage?: string;
    label?: string;
    required?: boolean;
    wrapperClassName?: string;
  };

export const Input = forwardRef<HTMLInputElement, BaseProps>(
  (
    {
      className,
      type,
      passwordToggle = true,
      autoComplete,
      variant,
      size,
      errorMessage,
      label,
      required,
      wrapperClassName,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    const { t } = useT('common');
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const errorId = `${id}-error`;
    const isPassword = type === 'password';
    const [show, setShow] = useState(false);
    const [showShake, setShowShake] = useState(false);
    const inputType = isPassword ? (show ? 'text' : 'password') : type;
    const resolvedAutoComplete =
      autoComplete ?? (isPassword ? 'current-password' : undefined);
    const hasError = !!errorMessage;

    // Trigger shake animation when error appears
    useEffect(() => {
      if (hasError) {
        setShowShake(true);
        const timer = setTimeout(() => setShowShake(false), 400);
        return () => clearTimeout(timer);
      }
    }, [hasError, errorMessage]);

    if (isPassword && passwordToggle) {
      return (
        <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
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
                inputVariants({ variant, size }),
                hasError && 'border-destructive focus-visible:ring-destructive',
                showShake && 'animate-shake',
                'pr-10',
                className,
              )}
              ref={ref}
              required={required}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? errorId : undefined}
              aria-errormessage={hasError ? errorId : undefined}
              {...props}
            />
            <button
              type="button"
              aria-label={
                show ? t('aria.hidePassword') : t('aria.showPassword')
              }
              aria-pressed={show}
              className="absolute inset-y-0 right-2 my-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors duration-150"
              onClick={() => setShow((v) => !v)}
            >
              {show ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {errorMessage && (
            <p
              id={errorId}
              role="alert"
              aria-live="polite"
              className="text-sm text-destructive flex items-center gap-1.5"
            >
              <XCircle className="size-4" aria-hidden="true" />
              {errorMessage}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
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
            inputVariants({ variant, size }),
            hasError && 'border-destructive focus-visible:ring-destructive',
            showShake && 'animate-shake',
            className,
          )}
          ref={ref}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
          aria-errormessage={hasError ? errorId : undefined}
          {...props}
        />
        {errorMessage && (
          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className="text-sm text-destructive flex items-center gap-1.5"
          >
            <Info className="size-4" aria-hidden="true" />
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
