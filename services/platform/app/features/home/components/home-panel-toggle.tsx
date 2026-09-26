'use client';

import { Button } from '@tale/ui/button';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useHomePanel } from './home-panel-context';

/**
 * Hides or shows the Home panel — the first control of every conversation
 * header (a chat, a task, a customer conversation), in the same place on
 * each, so the panel folds away for focus and comes back from wherever you
 * are. Desktop only (a phone has no panel beside the page), and only inside
 * a Home frame; it names the panel element while one is on screen.
 */
export function HomePanelToggle() {
  const { t } = useT('home');
  const { available, mounted, open, setOpen } = useHomePanel();
  if (!available) return null;
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={() => setOpen((previous) => !previous)}
      aria-label={open ? t('panel.hide') : t('panel.show')}
      aria-expanded={open}
      {...(mounted ? { 'aria-controls': 'home-panel' } : {})}
      className="text-muted-foreground hover:text-foreground pointer-events-auto -ml-2 hidden shrink-0 md:inline-flex"
    >
      {open ? (
        <PanelLeftClose className="size-5 p-0.25" />
      ) : (
        <PanelLeftOpen className="size-5 p-0.25" />
      )}
    </Button>
  );
}
