'use client';

/**
 * The composer's `+` menu — the modes a message can be sent in.
 *
 * A MODE is a property of the message you are about to send, not a stored
 * preference. "Read replies aloud" is the exception that proves it: its
 * state must be legible at a glance, so it lives as the dedicated toggle
 * beside the mic (`VoiceModeToggle`), not behind this menu. There is no
 * entry for choosing where a turn runs either — chat runs direct turns
 * only; work that needs a sandbox belongs to a Task.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Paperclip, Plus, Swords } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface ComposerModeMenuProps {
  /** Arena Mode — a live pair exists for this conversation. Absent (vs
   * false) means the surface cannot offer arena here at all (sandbox
   * thread, shared, fewer than two direct models) and the entry hides. */
  arenaActive?: boolean;
  onArenaChange?: (next: boolean) => void;
  onAttachFiles?: () => void;
  disabled?: boolean;
}

export function ComposerModeMenu({
  arenaActive,
  onArenaChange,
  onAttachFiles,
  disabled,
}: ComposerModeMenuProps) {
  const { t } = useT('composer');
  const { t: tChat } = useT('chat');

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const groups: DropdownMenuGroup[] = [];

    const actions: DropdownMenuGroup = [];
    if (onAttachFiles) {
      actions.push({
        type: 'item',
        label: t('addFiles'),
        icon: Paperclip,
        onClick: onAttachFiles,
      });
    }
    if (actions.length > 0) groups.push(actions);

    const modes: DropdownMenuGroup = [];
    if (arenaActive !== undefined && onArenaChange !== undefined) {
      modes.push({
        type: 'checkbox',
        label: tChat('arena.label'),
        icon: Swords,
        checked: arenaActive,
        onCheckedChange: onArenaChange,
      });
    }
    if (modes.length > 0) {
      groups.push([{ type: 'label', content: t('modeHeader') }, ...modes]);
    }

    return groups;
  }, [onAttachFiles, arenaActive, onArenaChange, t, tChat]);

  // "Read replies aloud" moved back to its own always-visible toggle beside
  // the mic; with no attach entry either, the menu can be entirely empty —
  // then the `+` renders nothing instead of opening a blank popover.
  if (items.length === 0) return null;

  return (
    <DropdownMenu
      align="start"
      tooltip={t('openMenu')}
      disabled={disabled}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('openMenu')}
          aria-haspopup="menu"
        >
          <Plus aria-hidden className="size-4" />
        </Button>
      }
      items={items}
    />
  );
}
