'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { Check, Minus } from 'lucide-react';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

export interface PermissionSummaryItem {
  /** What the permission is, in the reader's language: "Edit automations". */
  label: ReactNode;
  /** Whether what the label names is allowed. */
  allowed: boolean;
  /** A second line under the label: why it is not allowed, or its limit. */
  detail?: ReactNode;
}

export interface PermissionSummaryProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title' | 'children'
> {
  /** A heading for the list, such as "What Claude Code will be able to do". */
  title?: ReactNode;
  /** The permissions, in the order to read them. */
  items: readonly PermissionSummaryItem[];
  /** A closing line under the list, such as the role it is limited by. */
  footer?: ReactNode;
}

/**
 * What a choice lets someone do and what it does not: one line for each
 * permission, a check for what is allowed and a dash for what is not.
 *
 * The state is a shape and a word, never a colour alone: each line carries a
 * check or a dash and a visually hidden "Allowed" or "Not allowed" ahead of
 * its label, so a screen reader hears "Allowed Edit automations". The list
 * is named by `title` when there is one. It does not announce its own
 * changes; a host whose list changes as the reader chooses puts
 * `aria-live="polite"` on it.
 *
 * ```tsx
 * <PermissionSummary
 *   title="What this connection can do"
 *   items={[
 *     { label: 'Read automations', allowed: true },
 *     { label: 'Edit automations', allowed: false, detail: 'Your role does not allow it.' },
 *   ]}
 *   footer="Limited by your role, Developer."
 * />
 * ```
 */
export const PermissionSummary = forwardRef<
  HTMLDivElement,
  PermissionSummaryProps
>(({ title, items, footer, className, ...props }, ref) => {
  const { t } = useT('permissionSummary');
  const titleId = useId();
  return (
    <div
      ref={ref}
      className={cn(
        'border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-3 text-sm wrap-anywhere',
        className,
      )}
      {...props}
    >
      {title ? (
        <p id={titleId} className="text-foreground font-medium">
          {title}
        </p>
      ) : null}
      <ul
        role="list"
        aria-labelledby={title ? titleId : undefined}
        className="flex flex-col gap-2"
      >
        {items.map((item, index) => {
          const Icon = item.allowed ? Check : Minus;
          return (
            <li key={index} className="flex items-start gap-2">
              <Icon
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  item.allowed
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-muted-foreground',
                )}
              />
              <span
                className={cn(
                  'min-w-0',
                  item.allowed ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="sr-only">
                  {item.allowed ? t('allowed') : t('notAllowed')}{' '}
                </span>
                {item.label}
                {item.detail ? (
                  <span className="text-muted-foreground block text-xs">
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {footer ? (
        <p className="text-muted-foreground text-xs">{footer}</p>
      ) : null}
    </div>
  );
});
PermissionSummary.displayName = 'PermissionSummary';
