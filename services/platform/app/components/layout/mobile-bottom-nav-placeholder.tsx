import { BottomTabBarPlaceholder } from '@tale/ui/bottom-tab-bar';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender renders it under plain `bun`
 * (via DashboardShellFrame) — imports must stay framework-free: the
 * `@tale/ui` placeholder only.
 */

// MobileBottomNav shows Home, Knowledge, Automations and Settings — the rail's
// sections, with Settings from its foot. The count only moves the masked pills
// sideways — the placeholder is the live bar's height whatever the count.
const PLACEHOLDER_TABS = 4;

/**
 * Masked stand-in for MobileBottomNav, shown in the served boot shell and by
 * the dashboard layout while access resolves, so the content above it — the
 * chat composer on a chat route — sits where it will stay once the live bar
 * mounts.
 *
 * On Mobile Safari outside an installed app the live bar adds `pb-12` to clear
 * the browser's bottom toolbar. The pre-hydration script in `index.html` marks
 * that same case with `boot-safari-toolbar` on `<html>`, so the stand-in
 * reserves the clearance too.
 */
export function MobileBottomNavPlaceholder() {
  return (
    <BottomTabBarPlaceholder
      tabs={PLACEHOLDER_TABS}
      className="[.boot-safari-toolbar_&]:pb-12"
    />
  );
}
