import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
} from 'react';

import { cn } from '../../lib/cn';
import { Label } from './label';

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  description,
  error,
  required,
  children,
  className,
}: FieldProps) {
  const baseId = useId();
  const descriptionId = description ? `${baseId}-description` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;

  const describedBy =
    [errorId, descriptionId].filter(Boolean).join(' ') || undefined;

  // Inject aria-describedby (and aria-invalid when error is present) into the
  // first child element if it's a single valid element. This is best-effort:
  // call sites where children isn't a single element (e.g. a label-wrapped
  // checkbox) will simply not receive the props, leaving existing behavior.
  let enhancedChildren: ReactNode = children;
  const onlyChild = Children.count(children) === 1 ? children : null;
  if (
    isValidElement<Record<string, unknown>>(onlyChild) &&
    (describedBy || error)
  ) {
    const childProps = onlyChild.props;
    const rawDescribedBy = childProps['aria-describedby'];
    const existing =
      typeof rawDescribedBy === 'string' ? rawDescribedBy : undefined;
    const merged =
      [existing, describedBy].filter(Boolean).join(' ') || undefined;
    const rawInvalid = childProps['aria-invalid'];
    const fallbackInvalid =
      typeof rawInvalid === 'boolean' ? rawInvalid : undefined;
    enhancedChildren = cloneElement(onlyChild, {
      'aria-describedby': merged,
      'aria-invalid':
        error !== undefined && error !== null && error !== false
          ? true
          : fallbackInvalid,
    });
  }

  // A container that marks itself `data-field-layout="row"` puts every field
  // beneath it in label-left / control-right layout from `sm` up; everywhere
  // else fields stack. Pure CSS (`in-data-*` = "has such an ancestor"), so a
  // dialog — which portals out of that subtree — stacks again on its own.
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5',
        'in-data-[field-layout=row]:sm:flex-row in-data-[field-layout=row]:sm:items-start in-data-[field-layout=row]:sm:justify-between in-data-[field-layout=row]:sm:gap-6',
        className,
      )}
    >
      {label || (description && !error) ? (
        <div className="flex flex-col gap-1 in-data-[field-layout=row]:sm:max-w-xs in-data-[field-layout=row]:sm:shrink-0 in-data-[field-layout=row]:sm:pt-2">
          {label ? (
            <Label htmlFor={htmlFor}>
              {label}
              {required ? (
                <span
                  className="ml-0.5 text-[color:var(--color-danger)]"
                  aria-hidden
                >
                  *
                </span>
              ) : null}
            </Label>
          ) : null}
          {description && !error ? (
            <p
              id={descriptionId}
              className="text-xs text-[color:var(--color-fg-muted)]"
            >
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5 in-data-[field-layout=row]:sm:w-80 in-data-[field-layout=row]:sm:shrink-0">
        {enhancedChildren}
        {error ? (
          <p
            id={errorId}
            className="text-xs text-[color:var(--color-danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
