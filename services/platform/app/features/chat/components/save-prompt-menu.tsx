'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { BookOpen, Bookmark } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface SavePromptMenuProps {
  onSavePromptDraft: () => void;
  onOpenPromptLibrary: () => void;
  canSavePromptDraft: boolean;
  disabled?: boolean;
}

export function SavePromptMenu({
  onSavePromptDraft,
  onOpenPromptLibrary,
  canSavePromptDraft,
  disabled = false,
}: SavePromptMenuProps) {
  const { t: tChat } = useT('chat');

  // With an empty composer there's nothing to save as a draft, so the only
  // useful action is the prompt library. Skip the menu and open it directly.
  if (!canSavePromptDraft) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={tChat('promptLibrary')}
        tooltip={tChat('promptLibrary')}
        tooltipSide="top"
        disabled={disabled}
        onClick={onOpenPromptLibrary}
        className="focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset"
      >
        <Bookmark className="size-4" aria-hidden="true" />
      </Button>
    );
  }

  const items: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: tChat('savePromptDraft'),
        icon: Bookmark,
        onClick: onSavePromptDraft,
      },
      {
        type: 'item',
        label: tChat('promptLibrary'),
        icon: BookOpen,
        onClick: onOpenPromptLibrary,
      },
    ],
  ];

  return (
    <DropdownMenu
      tooltip={tChat('savePromptMenu')}
      tooltipSide="top"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={tChat('savePromptMenu')}
          aria-haspopup="menu"
          disabled={disabled}
          className="focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Bookmark className="size-4" aria-hidden="true" />
        </Button>
      }
      items={items}
      align="start"
    />
  );
}
