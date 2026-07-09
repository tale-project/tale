import { Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Product DataTable toolbar idiom: search left, primary add action
 * right-aligned on the same row. Used by Agents / Knowledge / Projects demos.
 */
export function DemoToolbar({
  searchPlaceholder,
  addLabel,
}: {
  searchPlaceholder: string;
  addLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="border-border-base bg-surface-site text-fg-muted flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 text-xs sm:max-w-[18rem]">
        <Search className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
        <span className="truncate">{searchPlaceholder}</span>
      </span>
      <span className="bg-accent-base text-accent-fg ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium">
        <Plus className="size-3.5" strokeWidth={2} />
        <span className="hidden sm:inline">{addLabel}</span>
      </span>
    </div>
  );
}

export function DemoTableShell({
  columns,
  children,
}: {
  /** Header cells — last column is typically right-aligned by the caller. */
  columns: readonly ReactNode[];
  children: ReactNode;
}) {
  const colTemplate = columns
    .map((_, i) => {
      if (i === 0) return '1.5fr';
      if (i === columns.length - 1) return '0.9fr';
      return '1fr';
    })
    .join(' ');

  return (
    <div className="border-border-base bg-surface-site-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div
        className="text-fg-subtle border-border-base grid gap-2 border-b px-3 py-2 text-[10px] font-medium tracking-wide uppercase md:px-4"
        style={{ gridTemplateColumns: colTemplate }}
      >
        {columns.map((col, i) => (
          <span
            key={i}
            className={i === columns.length - 1 ? 'text-right' : undefined}
          >
            {col}
          </span>
        ))}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function DemoTableRow({
  columns,
  colTemplate,
  children,
  className,
}: {
  columns?: number;
  colTemplate?: string;
  children: ReactNode;
  className?: string;
}) {
  const template =
    colTemplate ??
    (columns
      ? Array.from({ length: columns }, (_, i) =>
          i === 0 ? '1.5fr' : i === columns - 1 ? '0.9fr' : '1fr',
        ).join(' ')
      : undefined);

  return (
    <div
      className={
        className ??
        'border-border-base/60 grid items-center gap-2 border-b px-3 py-2.5 last:border-b-0 md:px-4'
      }
      style={template ? { gridTemplateColumns: template } : undefined}
    >
      {children}
    </div>
  );
}
