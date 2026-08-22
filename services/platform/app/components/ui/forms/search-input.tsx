'use client';

import { Description } from '@tale/ui/description';
import { Info, Search } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  useEffect,
  type FocusEvent,
  type InputHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils/cn';

import { Input } from './input';
import { Label } from './label';

/**
 * The width every toolbar search shares: it fills the row on a narrow screen
 * and settles at 18rem from `sm` up. Exported so the two filter bars that own
 * one — `DataTableFilters` and `CatalogToolbar` — cannot drift apart again; the
 * catalog's search was 16rem while every table page's was 18rem, so the same
 * "search + Filter" pair measured differently depending on the surface.
 */
export const TOOLBAR_SEARCH_WRAPPER = 'flex-1 sm:flex-none w-auto sm:w-[18rem]';

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
      onFocus,
      onBlur,
      placeholder,
      'aria-label': ariaLabel,
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
    const [isReadOnly, setIsReadOnly] = useState(true);

    // A placeholder is not an accessible name (it disappears on input and is
    // unreliably announced). When there's no visible <Label> and no explicit
    // aria-label, fall back to the placeholder so the input always exposes a
    // programmatic accessible name (WCAG 4.1.2).
    const accessibleName = ariaLabel ?? (label ? undefined : placeholder);

    useEffect(() => {
      if (hasError) {
        setShowShake(true);
        const timer = setTimeout(() => setShowShake(false), 400);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [hasError, errorMessage]);

    // Search is not a secret, so we don't mask it — but we still suppress
    // password-manager autofill the same way: readonly until focus.
    const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
      e.currentTarget.removeAttribute('readonly');
      setIsReadOnly(false);
      onFocus?.(e);
    };
    const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
      setIsReadOnly(true);
      onBlur?.(e);
    };

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
            variant="default"
            // A search box is a toolbar control, never a settings field: its
            // width comes from the caller (`className` / `wrapperClassName`),
            // and the label — when there is one — is rendered above by this
            // component, not by the field frame. Without this the box was
            // pinned to the settings 20rem control column on every
            // `data-field-layout="row"` surface, which left a dead 4rem gap
            // between it and the filter button beside it.
            wideControl
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-bwignore="true"
            readOnly={isReadOnly}
            // The readOnly above is an anti-autofill trick, not a read-only
            // display state — pin the bordered variant so Input's native
            // readOnly → borderless auto-selection doesn't strip the chrome.
            className={cn(
              'h-9 max-w-70 pl-10',
              hasError && 'border-destructive focus-visible:ring-destructive',
              showShake && 'animate-shake',
              className,
            )}
            required={required}
            placeholder={placeholder}
            aria-label={accessibleName}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-errormessage={hasError ? errorId : undefined}
            {...props}
            onFocus={handleFocus}
            onBlur={handleBlur}
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
          <Description id={descriptionId}>{description}</Description>
        )}
      </div>
    );
  },
);

SearchInput.displayName = 'SearchInput';
