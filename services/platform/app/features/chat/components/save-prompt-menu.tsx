'use client';

import { Button } from '@tale/ui/button';
import { BookOpen, Bookmark } from 'lucide-react';

import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
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

  const items: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: tChat('savePromptDraft'),
        icon: Bookmark,
        onClick: onSavePromptDraft,
        disabled: !canSavePromptDraft,
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
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={tChat('savePromptMenu')}
          aria-haspopup="menu"
          disabled={disabled}
        >
          <Bookmark className="size-4" aria-hidden="true" />
        </Button>
      }
      items={items}
      align="start"
    />
  );
}
