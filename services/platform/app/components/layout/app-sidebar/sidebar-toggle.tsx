'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useT } from '@/lib/i18n/client';

import { useSidebar } from './sidebar-context';
import { TILE_CLASS, TOOLTIP_SHORTCUT_CLASS } from './sidebar-motion';

/**
 * The expand/collapse control (⌘H). A single instance that never unmounts —
 * the header slides it between its two positions — so keyboard focus (and an
 * open tooltip) survives a toggle without any restoration logic.
 */
export function SidebarToggle() {
  const { isExpanded, toggleExpanded } = useSidebar();
  const { t } = useT('navigation');
  const isMac = useIsMac();

  const label = isExpanded ? t('sidebar.collapse') : t('sidebar.expand');
  const shortcut = isMac ? '⌘ H' : 'CTRL + H';
  const Icon = isExpanded ? PanelLeftClose : PanelLeftOpen;

  return (
    <Tooltip
      content={
        <>
          {label}
          <span className={TOOLTIP_SHORTCUT_CLASS}>{shortcut}</span>
        </>
      }
      side={isExpanded ? 'bottom' : 'right'}
      contentClassName="py-1.5"
    >
      <button
        type="button"
        onClick={toggleExpanded}
        aria-label={label}
        aria-expanded={isExpanded}
        aria-controls="chat-history-panel"
        className={TILE_CLASS}
      >
        <Icon className="size-5" />
      </button>
    </Tooltip>
  );
}
