import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
} from 'react';

import { FieldShell } from './field-shell';
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

  // The same frame every other labelled control renders in — `FieldShell`
  // owns the label-left/control-right row a `data-field-layout="row"` surface
  // asks for, and when it turns (a width of the surface, not the viewport).
  return (
    <FieldShell
      className={className}
      label={
        label ? (
          <Label htmlFor={htmlFor}>
            {label}
            {null}
          </Label>
        ) : undefined
      }
      description={
        description && !error ? (
          <p
            id={descriptionId}
            className="text-xs text-[color:var(--color-fg-muted)]"
          >
            {description}
          </p>
        ) : undefined
      }
      error={
        error ? (
          <p
            id={errorId}
            className="text-xs text-[color:var(--color-danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : undefined
      }
    >
      {enhancedChildren}
    </FieldShell>
  );
}
