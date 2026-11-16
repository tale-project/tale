import { Plus, Search } from 'lucide-react';

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
