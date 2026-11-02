import { cn } from '@tale/ui/cn';
import { FIELD_ROW_CONTROL, FIELD_ROW_FRAME } from '@tale/ui/field-shell';
import type { ReactNode } from 'react';

/** Read-only facts, as the names and values of a description list. */
export function InfoList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-4">{children}</dl>;
}

/**
 * One fact on the row layout of a settings page: its name where a label sits,
 * its value where the control sits, so it lines up with the rows above it. The
 * platform has no such row (its read-only values are a `SettingsRow` with a
 * value in it); a fact is a name and a value, which a description list says.
 */
export function InfoRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', FIELD_ROW_FRAME)}>
      <dt className="text-foreground text-sm font-medium @xl/field-layout:max-w-xs @xl/field-layout:min-w-0">
        {label}
      </dt>
      <dd
        className={cn(
          'text-foreground min-w-0 text-sm break-words',
          FIELD_ROW_CONTROL,
        )}
      >
        {children}
      </dd>
    </div>
  );
}
