'use client';

import { Server, Wrench } from 'lucide-react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Card } from '@/app/components/ui/layout/card';
import { Center, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import type { McpServerListItem } from './types';

interface McpServerCardProps {
  server: McpServerListItem;
  onClick: () => void;
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

export function McpServerCard({ server, onClick }: McpServerCardProps) {
  const { t } = useT('mcpServers');
  const toolCount = server.discoveredTools?.length ?? 0;

  return (
    <Card
      className="hover:border-primary/50 cursor-pointer transition-colors"
      contentClassName="p-0"
    >
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
    </Card>
  );
}
