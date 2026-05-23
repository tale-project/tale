'use client';

import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { Heading } from '@tale/ui/heading';
import { Center, HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Puzzle, type LucideIcon } from 'lucide-react';

import { Image } from '@/app/components/ui/data-display/image';
import { useT } from '@/lib/i18n/client';

interface IntegrationCardProps {
  title: string;
  description?: string;
  isActive?: boolean;
  status?: string;
  disabled?: boolean;
  iconUrl?: string;
  icon?: LucideIcon;
  onClick?: () => void;
}

export function IntegrationCard({
  title,
  description,
  isActive,
  status,
  disabled,
  iconUrl,
  icon: Icon = Puzzle,
  onClick,
}: IntegrationCardProps) {
  const { t } = useT('settings');

  return (
    <Card
      className="hover:border-primary/50 cursor-pointer transition-colors"
      contentClassName="p-0"
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full p-5 text-left outline-none disabled:opacity-50"
      >
        <Stack gap={3}>
          <HStack justify="between" align="start">
            <Center className="border-border size-11 rounded-lg border">
              {iconUrl ? (
                <Image
                  src={iconUrl}
                  alt={title}
                  className="size-6 object-contain"
                />
              ) : (
                <Icon className="size-6" />
              )}
            </Center>
            {status === 'error' ? (
              <Badge variant="destructive" dot>
                {t('integrations.badge.reconnectNeeded')}
              </Badge>
            ) : isActive ? (
              <Badge variant="green" dot>
                {t('integrations.badge.connected')}
              </Badge>
            ) : (
              <Badge variant="outline">{t('integrations.badge.connect')}</Badge>
            )}
          </HStack>
          <Stack gap={1}>
            <Heading
              level={3}
              size="base"
              tracking="tight"
              className="leading-none"
            >
              {title}
            </Heading>
            <Text variant="muted" className="line-clamp-2 leading-[1.43]">
              {description ?? title}
            </Text>
          </Stack>
        </Stack>
      </button>
    </Card>
  );
}
