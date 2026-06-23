'use client';

import { Button } from '@tale/ui/button';
import { PanelRightClose } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { useResizable } from '@/app/hooks/use-resizable';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatPanel } from './chat-panel-context';
import type { ChatPaneDescriptor, ChatPaneId } from './types';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;
const STRIP_WIDTH = 48;

const tabId = (id: ChatPaneId) => `chat-panel-tab-${id}`;
const bodyId = (id: ChatPaneId) => `chat-panel-body-${id}`;

/**
 * The unified chat panel. Renders one of three states from the live set
 * of content-bearing panes ({@link useChatPanel}'s `visiblePanes`):
 *
 *   - no visible pane → nothing (the right edge is clean on plain chats);
 *   - minimized → a shared 48px strip with one affordance per visible pane;
 *   - maximized → a resizable pane with a tab bar and the active body.
 *
 * Every visible pane's body is rendered simultaneously and inactive ones are
 * hidden with the `hidden` attribute (never unmounted), so the Live Browser's
 * RFB WebSocket and other live resources survive tab switches. The tab bar is a
 * hand-rolled WAI-ARIA tablist (rather than the shared Tabs primitive) because
 * the panels are owned here, not by Radix — this keeps `aria-controls` /
 * `aria-labelledby` wired to the real bodies.
 */
export function ChatPanel() {
  const { t } = useT('chat');
  const isMobile = useIsMobile();
  const { visiblePanes, activeTab, isMaximized, openPane, minimize } =
    useChatPanel();

  const panelRef = useRef<HTMLDivElement>(null);
  const { width, minWidth, maxWidth, handleMouseDown, handleKeyDown } =
    useResizable(panelRef, {
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      initialWidth: DEFAULT_WIDTH,
    });

  if (visiblePanes.length === 0) return null;

  // The active descriptor governs the visible body + header actions. The
  // context invariant keeps `activeTab` pointing at a visible pane, but fall
  // back to the first visible pane defensively.
  const activeId = activeTab ?? visiblePanes[0].id;

  // ── Minimized: the shared strip ──────────────────────────────────────────
  // On mobile the strip docks to the right edge as a fixed bar (the chat keeps
  // the full width behind it); on desktop it's an inline column in the flex row.
  if (!isMaximized) {
    return (
      <div
        role="toolbar"
        aria-orientation="vertical"
        aria-label={t('chatPanel.stripAria', { defaultValue: 'Chat panel' })}
        className={cn(
          'border-border bg-background flex h-full shrink-0 flex-col border-l',
          isMobile && 'fixed top-0 right-0 bottom-0 z-30',
        )}
        style={{ width: STRIP_WIDTH }}
      >
        {visiblePanes.map((pane) => (
          <StripButton key={pane.id} pane={pane} onOpen={openPane} />
        ))}
      </div>
    );
  }

  // ── Maximized: tabs + the active body (all bodies stay mounted) ──────────
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = visiblePanes.findIndex((p) => p.id === activeId);
    if (idx === -1) return;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + delta + visiblePanes.length) % visiblePanes.length;
    openPane(visiblePanes[nextIdx].id);
  };

  const activeHeaderActions = visiblePanes.find(
    (p) => p.id === activeId,
  )?.headerActions;

  return (
    <div
      className={cn(
        'border-border bg-background relative flex h-full shrink-0 flex-col border-l',
        // On mobile the panel is a full-screen fixed overlay above the chat so
        // the tabs + body are usable on a narrow viewport; on desktop it's a
        // fixed-width docked column in the flex row that the user can resize.
        // Fixed positioning (not a Radix Dialog) keeps every body mounted, so
        // the Live Browser's RFB socket survives minimize/maximize on mobile.
        isMobile && 'fixed inset-0 z-40 w-full border-l-0',
      )}
      style={isMobile ? undefined : { width }}
      role="complementary"
      aria-label={t('chatPanel.ariaLabel', { defaultValue: 'Chat panel' })}
    >
      {/* Drag-to-resize handle — desktop only (mobile is full-width). */}
      {!isMobile && (
        <div
          ref={panelRef}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('chatPanel.resizeAria', {
            defaultValue: 'Resize chat panel',
          })}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          tabIndex={0}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          className="focus-visible:ring-ring absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize focus-visible:ring-2 focus-visible:outline-none"
        />
      )}

      {/* Browser-style pill tabs: each pane is a rounded segment, the active
          one filled. The header keeps its bottom border as the panel's top
          divider; pills sit on it with vertical padding rather than overlapping
          it. The trailing actions stay vertically centered with the pills. */}
      <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
        <div
          role="tablist"
          aria-label={t('chatPanel.tablistAria', {
            defaultValue: 'Open panel',
          })}
          aria-orientation="horizontal"
          onKeyDown={onTabKeyDown}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {visiblePanes.map((pane) => {
            const isActive = pane.id === activeId;
            return (
              <button
                key={pane.id}
                type="button"
                role="tab"
                id={tabId(pane.id)}
                aria-selected={isActive}
                aria-controls={bodyId(pane.id)}
                aria-label={pane.ariaLabel}
                tabIndex={isActive ? 0 : -1}
                onClick={() => openPane(pane.id)}
                className={cn(
                  'focus-visible:ring-ring relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <pane.icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{pane.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeHeaderActions}
          <Tooltip
            content={t('chatPanel.minimize', {
              defaultValue: 'Minimize chat panel',
            })}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={minimize}
              aria-label={t('chatPanel.minimize', {
                defaultValue: 'Minimize chat panel',
              })}
            >
              <PanelRightClose className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {visiblePanes.map((pane) => (
          <div
            key={pane.id}
            role="tabpanel"
            id={bodyId(pane.id)}
            aria-labelledby={tabId(pane.id)}
            hidden={pane.id !== activeId}
            className="flex min-h-0 flex-1 flex-col"
          >
            {pane.body}
          </div>
        ))}
      </div>
    </div>
  );
}

function StripButton({
  pane,
  onOpen,
}: {
  pane: ChatPaneDescriptor;
  onOpen: (id: ChatPaneId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(pane.id)}
      aria-label={pane.ariaLabel}
      className="border-border hover:bg-muted/50 group flex shrink-0 cursor-pointer flex-col items-center gap-3 border-b py-4 transition-colors last:border-b-0"
    >
      <pane.icon className="text-muted-foreground group-hover:text-foreground size-4" />
      {pane.badge ?? (
        <span className="text-muted-foreground group-hover:text-foreground rotate-180 text-[10px] [writing-mode:vertical-rl]">
          {pane.label}
        </span>
      )}
    </button>
  );
}
