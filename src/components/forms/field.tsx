import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
} from 'react';

import { cn } from '../../lib/cn';
import { FIELD_INVALID } from './field-focus';
import {
  type FieldIssue,
  FieldIssueMessages,
  fieldIssueDescribedBy,
  fieldIssuesHaveError,
} from './field-issue-messages';
import { FieldShell } from './field-shell';
import { Label } from './label';

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  error?: ReactNode;
  /**
   * Problems a check found with this field's value, one line each under the
   * control. They describe the control (`aria-describedby`) and an error
   * among them marks it invalid (`aria-invalid` and the destructive border,
   * as `error` does), but they are never an alert: the check's
   * result is announced once elsewhere, not at every keystroke. Unlike
   * `error`, they leave the description in place.
   */
  issues?: ReadonlyArray<FieldIssue>;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A control that cannot be named by `<label for>` — a code editor's text
 * is a contenteditable element, not a labelable one — declares
 * `static fieldLabelling = 'labelledby'`, and `Field` names it with
 * `aria-labelledby` pointing at its label instead.
 */
function namedByLabelledBy(element: unknown): boolean {
  if (!isValidElement(element)) return false;
  const type: unknown = element.type;
  return (
    (typeof type === 'function' ||
      (typeof type === 'object' && type !== null)) &&
    (type as { fieldLabelling?: unknown }).fieldLabelling === 'labelledby'
  );
}

export function Field({
  label,
  htmlFor,
  description,
  error,
  issues,
  children,
  className,
}: FieldProps) {
  const baseId = useId();
  const labelId = label ? `${baseId}-label` : undefined;
  const descriptionId = description ? `${baseId}-description` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const issuesId = fieldIssueDescribedBy(baseId, issues);
  const invalid =
    (error !== undefined && error !== null && error !== false) ||
    fieldIssuesHaveError(issues);

  const describedBy =
    [errorId, issuesId, descriptionId].filter(Boolean).join(' ') || undefined;

  // Inject aria-describedby (and, when an error or an error among the issues
  // is present, aria-invalid and the destructive border of the design's
  // Error state) into the first child element if it's a single valid
  // element. This is best-effort: call sites where children isn't a single
  // element (e.g. a label-wrapped checkbox) will simply not receive the
  // props, leaving existing behavior.
  let enhancedChildren: ReactNode = children;
  const onlyChild = Children.count(children) === 1 ? children : null;
  const labelledBy =
    labelId !== undefined && namedByLabelledBy(onlyChild) ? labelId : undefined;
  if (
    isValidElement<Record<string, unknown>>(onlyChild) &&
    (describedBy || invalid || labelledBy)
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
    const rawClassName = childProps['className'];
    const rawLabelledBy = childProps['aria-labelledby'];
    enhancedChildren = cloneElement(onlyChild, {
      'aria-describedby': merged,
      'aria-invalid': invalid ? true : fallbackInvalid,
      ...(labelledBy !== undefined && {
        'aria-labelledby': [
          typeof rawLabelledBy === 'string' ? rawLabelledBy : undefined,
          labelledBy,
        ]
          .filter(Boolean)
          .join(' '),
      }),
      ...(invalid && {
        className: cn(
          typeof rawClassName === 'string' ? rawClassName : undefined,
          FIELD_INVALID,
        ),
      }),
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
          <Label id={labelId} htmlFor={htmlFor}>
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
        error || issuesId ? (
          <>
            {error ? (
              <p id={errorId} className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}
            <FieldIssueMessages issues={issues} idPrefix={baseId} />
          </>
        ) : undefined
      }
    >
      {enhancedChildren}
    </FieldShell>
  );
}
