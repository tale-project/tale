'use client';

import { Info, Search } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  useEffect,
  type InputHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils/cn';

import { Description } from './description';
import { Input } from './input';
import { Label } from './label';

interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type'
> {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  wrapperClassName?: string;
  label?: string;
  description?: ReactNode;
  errorMessage?: string;
  required?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      wrapperClassName,
      label,
      description,
      errorMessage,
      required,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const errorId = `${id}-error`;
    const descriptionId = `${id}-description`;
    const hasError = !!errorMessage;
    const describedBy =
      [description && descriptionId, hasError && errorId]
        .filter(Boolean)
        .join(' ') || undefined;
    const [showShake, setShowShake] = useState(false);

    useEffect(() => {
      if (hasError) {
        setShowShake(true);
        const timer = setTimeout(() => setShowShake(false), 400);
        return () => clearTimeout(timer);
      }
    }, [hasError, errorMessage]);

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <Label htmlFor={id} required={required} error={hasError}>
            {label}
          </Label>
        )}
        <div className="relative">
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2 transform"
            aria-hidden="true"
          />
          <Input
            ref={ref}
            id={id}
            type="text"
            className={cn(
              'pl-10',
              hasError && 'border-destructive focus-visible:ring-destructive',
              showShake && 'animate-shake',
              className,
            )}
            required={required}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-errormessage={hasError ? errorId : undefined}
            {...props}
          />
        </div>
        {errorMessage && (
          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className="text-destructive flex items-center gap-1.5 text-sm"
          >
            <Info className="size-4" aria-hidden="true" />
            {errorMessage}
          </p>
        )}
        {description && (
          <Description id={descriptionId} className="text-xs">
            {description}
          </Description>
        )}
      </div>
    );
  },
);

SearchInput.displayName = 'SearchInput';
