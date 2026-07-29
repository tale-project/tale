// Relative import on purpose: this module also runs under plain `bun`
// (the boot-shell prerender), where the `@/` tsconfig alias isn't guaranteed.
import { ChatHistorySkeleton } from './chat-history-skeleton';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` at build time (via DashboardShellFrame) — imports must stay
 * framework-free: the shared skeleton and static markup only, no router, no
 * state, no `cn`.
 */

/**
 * Masked stand-in for the chat sub-panel (ChatSubPanel), shown before the
 * real chat route can mount it: baked into the served boot shell and
 * rendered by the dashboard layout while access resolves. Mirrors the real
 * panel's frame (SubPanel `wide`: 256px, right border, hidden below `md`)
 * and ChatHistorySidebar's desktop padding, with the shared list skeleton
 * inside — so the live panel slots in without reflow.
 *
 * Whether it shows is decided entirely in CSS by the `boot-chat-panel-open`
 * class on `<html>`, set by the pre-hydration script in `index.html` when
 * the navigation targets a chat route and the persisted panel state
 * (`chat-history-panel-open-<orgId>`, written by ChatLayoutProvider) is
 * open. Pure CSS so the served shell — static, identical for every route —
 * and the React-rendered placeholders agree on one decision made before
 * first paint; a collapsed panel never flashes in, an open one never pops
 * in late.
 */
export function ChatSubPanelPlaceholder() {
  return (
    <div className="bg-background border-border hidden h-full w-64 shrink-0 flex-col overflow-hidden border-r [.boot-chat-panel-open_&]:md:flex">
      <div className="flex h-full w-full flex-col overflow-hidden px-2.5 pt-2.5 pb-3.5">
        <ChatHistorySkeleton />
      </div>
    </div>
  );
}
