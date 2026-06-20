'use client';

import { Badge } from '@tale/ui/badge';
import { Puzzle, type LucideIcon } from 'lucide-react';

import {
  CatalogCard,
  CatalogCardIcon,
} from '@/app/components/catalog/catalog-grid';
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

  const badge =
    status === 'error' ? (
      <Badge variant="destructive" dot>
        {t('integrations.badge.reconnectNeeded')}
      </Badge>
    ) : isActive ? (
      <Badge variant="green" dot>
        {t('integrations.badge.connected')}
      </Badge>
    ) : (
      <Badge variant="outline">{t('integrations.badge.connect')}</Badge>
    );

  return (
    <CatalogCard
      media={
        <CatalogCardIcon>
          {iconUrl ? (
            <Image
              src={iconUrl}
              alt={title}
              className="size-6 object-contain"
            />
          ) : (
            <Icon className="size-6" />
          )}
        </CatalogCardIcon>
      }
      title={title}
      description={description ?? title}
      badge={badge}
      onClick={onClick}
      disabled={disabled}
      ariaLabel={title}
    />
  );
}
