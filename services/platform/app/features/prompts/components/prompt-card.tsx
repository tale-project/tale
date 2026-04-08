'use client';

import { Hash, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { PromptTemplate } from '../hooks/queries';

interface PromptCardProps {
  prompt: PromptTemplate;
  onUse: (prompt: PromptTemplate) => void;
  onEdit?: (prompt: PromptTemplate) => void;
  onDelete?: (prompt: PromptTemplate) => void;
  canModify: boolean;
}

export function PromptCard({
  prompt,
  onUse,
  onEdit,
  onDelete,
  canModify,
}: PromptCardProps) {
  const { t } = useT('prompts');

  const handleUse = useCallback(() => {
    onUse(prompt);
  }, [onUse, prompt]);

  const menuItems: DropdownMenuGroup[] = useMemo(() => {
    const group: DropdownMenuGroup = [];
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
  }, [onEdit, onDelete, prompt, t]);

  const scopeVariant =
    prompt.scope === 'personal'
      ? 'blue'
      : prompt.scope === 'team'
        ? 'orange'
        : 'green';

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border border-border bg-background p-4 transition-colors hover:bg-muted/50',
      )}
    >
      <HStack justify="between" align="start">
        <VStack className="min-w-0 flex-1 gap-1">
          <Text as="h3" variant="label" className="truncate font-medium">
            {prompt.title}
          </Text>
          {prompt.description && (
            <Text as="p" variant="muted" className="line-clamp-2 text-xs">
              {prompt.description}
            </Text>
          )}
        </VStack>
        {canModify && (
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t('actions.more')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
            items={menuItems}
            align="end"
          />
        )}
      </HStack>

      <Text as="p" variant="muted" className="line-clamp-3 font-mono text-xs">
        {prompt.content}
      </Text>

      <HStack justify="between" align="center" className="mt-auto pt-1">
        <HStack gap={1} wrap className="min-w-0">
          <Badge variant={scopeVariant}>{t(`scope.${prompt.scope}`)}</Badge>
          {prompt.category && (
            <Badge variant="outline">
              <Hash className="mr-0.5 size-3" />
              {prompt.category}
            </Badge>
          )}
        </HStack>
        <Tooltip content={t('actions.usePrompt')} side="top">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleUse}
            className="shrink-0"
          >
            {t('actions.use')}
          </Button>
        </Tooltip>
      </HStack>

      {prompt.usageCount > 0 && (
        <Text as="span" variant="caption" className="text-muted-foreground">
          {t('usageCount', { count: prompt.usageCount })}
        </Text>
      )}
    </div>
  );
}
