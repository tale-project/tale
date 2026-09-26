// Relative import on purpose: this module also runs under plain `bun`
// (the boot-shell prerender), where the `@/` tsconfig alias isn't guaranteed.
import { HomePanelSkeleton } from './home-panel-skeleton';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` at build time (via DashboardShellFrame) — imports must stay
 * framework-free: the shared skeleton and static markup only, no router, no
 * state, no `cn`.
 */

/**
 * Masked stand-in for the Home panel, shown before the real one can mount:
 * baked into the served boot shell and rendered by the dashboard layout
 * while access resolves. Mirrors the real panel's frame (SubPanel `list`:
 * 280px, right border, hidden below `md`) with the shared panel skeleton
 * inside — so the live panel slots in without reflow.
 *
 * Whether it shows is decided entirely in CSS by the `boot-home-panel-open`
 * class on `<html>`, set by the pre-hydration script in `index.html` when
 * the navigation targets a Home route and the panel is open there (always,
 * except on a conversation-shaped page the persisted
 * `chat-history-panel-open-<orgId>` state has folded it on), and kept in
 * step at runtime by the live HomePanel. Pure CSS so the served shell —
 * static, identical for every route — and the React-rendered placeholders
 * agree on one decision made before first paint; a folded panel never
 * flashes in, an open one never pops in late.
 */
export function HomePanelPlaceholder() {
  return (
    <div className="bg-background border-border hidden h-full w-70 shrink-0 flex-col overflow-hidden border-r [.boot-home-panel-open_&]:md:flex">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <HomePanelSkeleton />
      </div>
    </div>
  );
}
