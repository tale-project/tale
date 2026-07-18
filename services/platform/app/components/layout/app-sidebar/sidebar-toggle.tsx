'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useRef, type MutableRefObject } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useT } from '@/lib/i18n/client';

import { useSidebar } from './sidebar-context';
import { TILE_CLASS, TOOLTIP_SHORTCUT_CLASS } from './sidebar-motion';

export interface SidebarToggleProps {
  /**
   * Set to `true` by the click handler right before toggling; the instance
   * that mounts in the other position claims it on mount and takes focus, so
   * keyboard users never lose their place when the button repositions
   * (expanded: header end ↔ collapsed: tile under the logo).
   */
  focusPendingRef: MutableRefObject<boolean>;
  /** Where this instance renders — picks the tooltip side. */
  placement: 'header' | 'rail';
}

/** The expand/collapse control (⌘H). One logical button, two positions. */
export function SidebarToggle({
  focusPendingRef,
  placement,
}: SidebarToggleProps) {
  const { isExpanded, toggleExpanded } = useSidebar();
  const { t } = useT('navigation');
  const isMac = useIsMac();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusPendingRef.current) {
      focusPendingRef.current = false;
      buttonRef.current?.focus();
    }
  }, [focusPendingRef]);

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
      side={placement === 'header' ? 'bottom' : 'right'}
      contentClassName="py-1.5"
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          focusPendingRef.current = true;
          toggleExpanded();
        }}
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
