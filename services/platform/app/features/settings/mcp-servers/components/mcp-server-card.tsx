'use client';

import { Badge } from '@tale/ui/badge';
import { IconButton } from '@tale/ui/icon-button';
import { Ellipsis, Pencil, Server, Trash2, Wrench } from 'lucide-react';
import { useMemo } from 'react';

import { Card } from '@/app/components/ui/layout/card';
import { Center, HStack, Stack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import type { McpServerListItem } from './types';

interface McpServerCardProps {
  server: McpServerListItem;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useT('mcpServers');

  if (status === 'active') {
    return (
      <Badge variant="green" dot>
        {t('connected')}
      </Badge>
    );
  }
  if (status === 'error') {
    return <Badge variant="destructive">{t('error')}</Badge>;
  }
  return <Badge variant="outline">{t('disconnected')}</Badge>;
}

function TransportBadge({ type }: { type: string }) {
  const label = type === 'stdio' ? 'stdio' : type === 'sse' ? 'SSE' : 'HTTP';
  return <Badge variant="blue">{label}</Badge>;
}

export function McpServerCard({
  server,
  onClick,
  onEdit,
  onDelete,
}: McpServerCardProps) {
  const { t } = useT('mcpServers');
  const { t: tCommon } = useT('common');
  const toolCount = server.discoveredTools?.length ?? 0;

  const menuItems = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item' as const,
          label: t('editServer'),
          icon: Pencil,
          onClick: onEdit,
        },
      ],
      [
        {
          type: 'item' as const,
          label: t('deleteServer'),
          icon: Trash2,
          onClick: onDelete,
          destructive: true,
        },
      ],
    ],
    [t, onEdit, onDelete],
  );

  return (
    <Card
      className="hover:border-primary/50 cursor-pointer transition-colors"
      contentClassName="p-0"
    >
      <div className="relative">
        <div className="absolute right-5 bottom-5 z-10">
          <DropdownMenu
            trigger={
              <IconButton
                icon={Ellipsis}
                aria-label={tCommon('aria.actionsMenu')}
                variant="ghost"
                className="size-8"
                onClick={(e) => e.stopPropagation()}
              />
            }
            items={menuItems}
            align="end"
          />
        </div>
        <button
          type="button"
          onClick={onClick}
          className="w-full p-5 text-left outline-none"
        >
          <Stack gap={3}>
            <HStack justify="between" align="start">
              <Center className="border-border size-11 rounded-lg border">
                <Server className="text-muted-foreground size-6" />
              </Center>
              <StatusBadge status={server.status} />
            </HStack>
            <Stack gap={1}>
              <Heading
                level={3}
                size="base"
                tracking="tight"
                className="leading-none"
              >
                {server.displayName}
              </Heading>
              {server.description && (
                <Text variant="muted" className="line-clamp-2 leading-[1.43]">
                  {server.description}
                </Text>
              )}
            </Stack>
            <HStack gap={2} align="center">
              <TransportBadge type={server.transportType} />
              {server.authType !== 'none' && (
                <Badge variant="outline">
                  {server.authType === 'api_key'
                    ? t('form.apiKey')
                    : t('form.oauth2')}
                </Badge>
              )}
              {toolCount > 0 && (
                <HStack gap={1} align="center">
                  <Wrench className="text-muted-foreground size-3.5" />
                  <Text variant="muted" className="text-xs">
                    {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
                  </Text>
                </HStack>
              )}
            </HStack>
          </Stack>
        </button>
      </div>
    </Card>
  );
}
