'use client';

/**
 * The composer's `+` menu — the modes a message can be sent in.
 *
 * A MODE is a property of the message you are about to send, not a stored
 * preference: "Read replies aloud" belongs here, next to attaching a file,
 * and nowhere in the preferences page. There is no entry for choosing where
 * a turn runs either — that is decided by the agent picked in the same row
 * (the platform agent runs direct; an external agent runs in a sandbox).
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { BookOpen, Paperclip, Plus, Swords, Volume2 } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface ComposerModeMenuProps {
  /** Read replies aloud — the resolved per-thread/user state, written back
   * server-side by the parent. */
  voiceOutput: boolean;
  onVoiceOutputChange: (next: boolean) => void;
  /** Org governance vetoed voice output — the mode is not advertised. */
  voiceOutputHidden?: boolean;
  /** No TTS-capable model is configured — shown but disabled. */
  voiceOutputAvailable?: boolean;
  /** Arena Mode — a live pair exists for this conversation. Absent (vs
   * false) means the surface cannot offer arena here at all (sandbox
   * thread, shared, fewer than two direct models) and the entry hides. */
  arenaActive?: boolean;
  onArenaChange?: (next: boolean) => void;
  onAttachFiles?: () => void;
  /** Open the skill library — browse, create, upload, share skills. */
  onOpenSkillLibrary?: () => void;
  disabled?: boolean;
}

export function ComposerModeMenu({
  voiceOutput,
  onVoiceOutputChange,
  voiceOutputHidden = false,
  voiceOutputAvailable = true,
  arenaActive,
  onArenaChange,
  onAttachFiles,
  onOpenSkillLibrary,
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
    if (onOpenSkillLibrary) {
      actions.push({
        type: 'item',
        label: t('skillLibrary'),
        icon: BookOpen,
        onClick: onOpenSkillLibrary,
      });
    }
    if (actions.length > 0) groups.push(actions);

    const modes: DropdownMenuGroup = [];
    if (!voiceOutputHidden) {
      modes.push({
        type: 'checkbox',
        label: tChat('voice.voiceModeEnable'),
        ...(voiceOutputAvailable
          ? {}
          : { description: tChat('voice.voiceOutputErrorConfig') }),
        icon: Volume2,
        checked: voiceOutput,
        disabled: !voiceOutputAvailable,
        onCheckedChange: onVoiceOutputChange,
      });
    }
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
  }, [
    onAttachFiles,
    onOpenSkillLibrary,
    voiceOutput,
    onVoiceOutputChange,
    voiceOutputHidden,
    voiceOutputAvailable,
    arenaActive,
    onArenaChange,
    t,
    tChat,
  ]);

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
