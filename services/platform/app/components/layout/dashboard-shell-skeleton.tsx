import { Skeleton } from '@tale/ui/skeleton';

// Mirrors the wrapper structure of DashboardLayout's resolved render
// (services/platform/app/routes/dashboard/$id.tsx) so that when auth +
// member context resolve, the real chrome slots in without reflow —
// only the inner placeholders swap to real content.
//
// The outer frame matches `$id.tsx` exactly: `h-dvh w-full` (NOT
// `size-full` — the dvh lock prevents a vertical jump when the real
// layout mounts), the mobile top bar carries the same `border-b` +
// `pt-[calc(var(--safe-top)+0.75rem)]` as the live bar, and a mobile
// bottom-nav placeholder reserves the `MobileBottomNav` strip so the
// `<main>` viewport height doesn't shrink on resolve.
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
    <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      {/* Mobile top bar — matches $id.tsx's bar (border-b + safe-top pad) */}
      <div className="bg-background border-border flex items-center gap-2 border-b p-2 pt-[calc(var(--safe-top)+0.75rem)] md:hidden">
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

      {/* Mobile bottom-nav placeholder — reserves the `MobileBottomNav`
          (`BottomTabBar`) strip's height so `<main>` doesn't grow taller on
          resolve. Matches the live bar: `min-h-12` tab buttons + the
          `pb-(--safe-bottom)` home-indicator clearance + `border-t`. */}
      <div className="bg-background border-border flex min-h-12 border-t pb-(--safe-bottom) md:hidden" />
    </div>
  );
}
