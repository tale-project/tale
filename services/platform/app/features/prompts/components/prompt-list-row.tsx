'use client';

import { Button } from '@tale/ui/button';
import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { HStack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { PromptTemplate } from '../hooks/queries';

interface PromptListRowProps {
  prompt: PromptTemplate;
  onUse: (prompt: PromptTemplate) => void;
  onEdit?: (prompt: PromptTemplate) => void;
  onDelete?: (prompt: PromptTemplate) => void;
  canModify: boolean;
  isLast: boolean;
}

export function PromptListRow({
  prompt,
  onUse,
  onEdit,
  onDelete,
  canModify,
  isLast,
}: PromptListRowProps) {
  const { t } = useT('prompts');
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleUse = useCallback(() => {
    onUse(prompt);
  }, [onUse, prompt]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(prompt.content);
    toast({ title: t('actions.copied'), variant: 'success' });
  }, [prompt.content, toast, t]);

  const menuItems: DropdownMenuGroup[] = useMemo(() => {
    const group: DropdownMenuGroup = [
      {
        type: 'item',
        label: t('actions.copy'),
        icon: Copy,
        onClick: handleCopy,
      },
    ];
    if (onEdit) {
      group.push({
        type: 'item',
        label: t('actions.edit'),
        icon: Pencil,
        onClick: () => onEdit(prompt),
      });
    }
    if (onDelete) {
      group.push({
        type: 'item',
        label: t('actions.delete'),
        icon: Trash2,
        onClick: () => onDelete(prompt),
        destructive: true,
      });
    }
    return [group];
  }, [handleCopy, onEdit, onDelete, prompt, t]);

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-3 p-3 transition-colors hover:bg-accent/50',
        !isLast && 'border-border border-b',
      )}
    >
      <button
        type="button"
        onClick={handleUse}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <Text as="div" variant="label" className="truncate text-sm font-medium">
          {prompt.title}
        </Text>
        <Text as="div" variant="muted" className="mt-0.5 line-clamp-1 text-xs">
          {prompt.content}
        </Text>
      </button>

      <HStack
        gap={1}
        className={cn(
          'shrink-0 transition-opacity',
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {canModify && (
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('actions.more')}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
            items={menuItems}
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
          />
        )}
      </HStack>
    </div>
  );
}
