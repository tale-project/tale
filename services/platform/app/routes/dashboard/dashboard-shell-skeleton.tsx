import { Skeleton } from '@tale/ui/skeleton';

// Mirrors the wrapper structure of DashboardLayout's resolved render
// (services/platform/app/routes/dashboard/$id.tsx) so that when auth +
// member context resolve, the real chrome slots in without reflow —
// only the inner placeholders swap to real content.
export function DashboardShellSkeleton() {
  return (
    <div className="flex size-full flex-col overflow-hidden md:flex-row">
      {/* Mobile top bar */}
      <div className="bg-background flex h-[--nav-size] items-center gap-2 p-2 md:hidden">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Desktop side nav */}
      <div className="bg-background hidden h-full px-2 py-3 md:flex md:flex-[0_0_var(--nav-size)] md:flex-col md:items-center md:justify-between">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex flex-col items-center gap-2 pt-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="size-8 rounded-md" />
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>

      <main className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l" />
    </div>
  );
}
