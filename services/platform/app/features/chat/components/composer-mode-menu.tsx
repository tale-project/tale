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
import { BookOpen, Paperclip, Plus, Volume2 } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface ComposerModeMenuProps {
  /** Read replies aloud, for the message being composed. */
  voiceOutput: boolean;
  onVoiceOutputChange: (next: boolean) => void;
  onAttachFiles?: () => void;
  /** Open the skill library — browse, create, upload, share skills. */
  onOpenSkillLibrary?: () => void;
  disabled?: boolean;
}

export function ComposerModeMenu({
  voiceOutput,
  onVoiceOutputChange,
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

    groups.push([
      { type: 'label', content: t('modeHeader') },
      {
        type: 'checkbox',
        label: tChat('voice.voiceModeEnable'),
        icon: Volume2,
        checked: voiceOutput,
        onCheckedChange: onVoiceOutputChange,
      },
    ]);

    return groups;
  }, [
    onAttachFiles,
    onOpenSkillLibrary,
    voiceOutput,
    onVoiceOutputChange,
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
