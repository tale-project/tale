'use client';

import { Puzzle, type LucideIcon } from 'lucide-react';

import { Image } from '@/app/components/ui/data-display/image';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Card } from '@/app/components/ui/layout/card';
import { Center, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

interface IntegrationCardProps {
  title: string;
  description?: string;
  isActive?: boolean;
  isCustom?: boolean;
  disabled?: boolean;
  iconUrl?: string;
  icon?: LucideIcon;
  onClick?: () => void;
}

export function IntegrationCard({
  title,
  description,
  isActive,
  isCustom,
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
            {isActive ? (
              <Badge variant="green" dot>
                {isCustom
                  ? t('integrations.badge.active')
                  : t('integrations.badge.connected')}
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
