'use client';

import { Button } from '@tale/ui/button';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMac } from '@tale/ui/use-is-mac';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { TOOLTIP_SHORTCUT_CLASS } from '@/app/components/layout/app-sidebar/sidebar-motion';
import { useT } from '@/lib/i18n/client';

import { useHomePanel } from './home-panel-context';

/**
 * Hides or shows the Home panel — the first control of every conversation
 * header (a chat, a task, a customer conversation) and of a project's
 * header, in the same place on each, so the panel folds away for focus and
 * comes back from wherever you are. Desktop only (a phone has no panel
 * beside the page), and only inside a Home frame; it names the panel element
 * while one is on screen.
 */
export function HomePanelToggle() {
  const { t } = useT('home');
  const { available, mounted, open, setOpen } = useHomePanel();
  const isMac = useIsMac();
  if (!available) return null;
  const label = open ? t('panel.hide') : t('panel.show');
  const shortcut = isMac ? '⌘ \\' : 'Ctrl + \\';
  return (
    <Tooltip
      content={
        <>
          {label}
          <span className={TOOLTIP_SHORTCUT_CLASS}>{shortcut}</span>
        </>
      }
      side="bottom"
    >
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={label}
        aria-expanded={open}
        aria-keyshortcuts={isMac ? 'Meta+Backslash' : 'Control+Backslash'}
        {...(mounted ? { 'aria-controls': 'home-panel' } : {})}
        className="text-muted-foreground hover:text-foreground pointer-events-auto -ml-2 hidden shrink-0 md:inline-flex"
      >
        {open ? (
          <PanelLeftClose className="size-5 p-0.25" />
        ) : (
          <PanelLeftOpen className="size-5 p-0.25" />
        )}
      </Button>
    </Tooltip>
  );
}
