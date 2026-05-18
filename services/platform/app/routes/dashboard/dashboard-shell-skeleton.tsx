import { Skeleton } from '@tale/ui/skeleton';

// Mirrors the wrapper structure of DashboardLayout's resolved render
// (services/platform/app/routes/dashboard/$id.tsx) so that when auth +
// member context resolve, the real chrome slots in without reflow —
// only the inner placeholders swap to real content.
//
// Side-nav structure mirrors `Navigation`
// (services/platform/app/components/ui/navigation/navigation.tsx): outer
// is plain `px-2`, inner column owns the `py-3` rows. Middle is an empty
// `flex-1` spacer rather than a fixed item count, because the real item
// count is CASL-gated (4–6 depending on role) and not known until auth
// resolves — any hardcoded count would shift on resolve for at least one
// role.
export function DashboardShellSkeleton() {
  return (
    <div className="flex size-full flex-col overflow-hidden md:flex-row">
      {/* Mobile top bar */}
      <div className="bg-background flex h-[--nav-size] items-center gap-2 p-2 md:hidden">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Desktop side nav — outer matches $id.tsx exactly */}
      <div className="bg-background hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
        <div className="border-border flex h-full flex-col">
          <div className="flex flex-shrink-0 items-center justify-center py-3">
            <Skeleton className="size-8 rounded-md" />
          </div>
          <div className="mx-1 min-h-0 flex-1 overflow-y-auto py-4" />
          <div className="flex flex-shrink-0 flex-col items-center gap-2 py-3">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </div>
      </div>

      <main className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l" />
    </div>
  );
}
