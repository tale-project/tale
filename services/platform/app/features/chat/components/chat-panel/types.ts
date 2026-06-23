import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The four panes that can occupy the unified chat panel. `order` is
 * derived from this tuple's index so tabs and strip affordances always appear
 * in a stable left-to-right / top-to-bottom sequence regardless of the order
 * the panes happen to register in.
 */
export const CHAT_PANE_ORDER = ['plan', 'canvas', 'files', 'browser'] as const;

export type ChatPaneId = (typeof CHAT_PANE_ORDER)[number];

/**
 * A pane's contribution to the shell. Each pane keeps its own data hooks and
 * body JSX and publishes one of these via {@link useRegisterPane}; the
 * `<ChatPanel>` shell reads the live set and renders the shared strip, the tab
 * bar, and the stacked bodies. The pane components themselves render nothing.
 */
export interface ChatPaneDescriptor {
  id: ChatPaneId;
  /** Tab/strip label icon (e.g. Telescope, PanelRightOpen, Folder). */
  icon: LucideIcon;
  /** Already-translated short label (each pane owns its own `useT`). */
  label: string;
  /** Accessible name for the strip button and tab trigger. */
  ariaLabel: string;
  /**
   * Optional count/progress chip shown on the strip affordance (e.g. the plan
   * progress badge or the canvas file count).
   */
  badge?: ReactNode;
  /**
   * Whether the pane currently has anything to show. The shell only renders a
   * tab/strip affordance for panes whose `hasContent` is true; when no pane has
   * content the whole shell renders nothing.
   */
  hasContent: boolean;
  /**
   * The pane's open-state body, kept intact from the original pane. The shell
   * keeps every registered body mounted (toggling visibility, never
   * unmounting) so live resources — most importantly the Live Browser's RFB
   * WebSocket — survive tab switches.
   */
  body: ReactNode;
  /**
   * Optional controls shown in the shell header (to the right of the tabs)
   * while this pane is the active tab — e.g. the files Show-hidden/Refresh
   * actions or the live-browser Reset button + control badge.
   */
  headerActions?: ReactNode;
}
