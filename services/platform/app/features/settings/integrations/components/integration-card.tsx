'use client';

import { Badge } from '@tale/ui/badge';
import { Copy, Download, Eye, Puzzle, type LucideIcon } from 'lucide-react';

import {
  CatalogCard,
  CatalogCardIcon,
} from '@/app/components/catalog/catalog-grid';
import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { Image } from '@/app/components/ui/data-display/image';
import {
  EntityRowActions,
  type EntityRowAction,
} from '@/app/components/ui/entity/entity-row-actions';
import { useT } from '@/lib/i18n/client';

interface IntegrationCardProps {
  title: string;
  description?: string;
  /** Definition catalog chips, rendered in the card's meta row. */
  labels?: string[];
  isActive?: boolean;
  status?: string;
  disabled?: boolean;
  iconUrl?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  /** Download this integration's files as a zip (fills the ⋯ Export action). */
  onExport?: () => void;
  /** Clone this integration under a new slug (fills the ⋯ Duplicate action). */
  onDuplicate?: () => void;
}

export function IntegrationCard({
  title,
  description,
  labels,
  isActive,
  status,
  disabled,
  iconUrl,
  icon: Icon = Puzzle,
  onClick,
  onExport,
  onDuplicate,
}: IntegrationCardProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

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
      meta={<CatalogLabels labels={labels} tone="quiet" />}
      onClick={onClick}
      disabled={disabled}
      ariaLabel={title}
      // A trailing ⋯ menu so integration cards align with the automations and
      // skills catalogs. Disconnect/Delete are intentionally NOT wired here:
      // they live in the detail panel's `useIntegrationManage` hook + Convex
      // actions (out of scope for the card). "View details" opens the same
      // panel a card click does — the shared quick action until Export lands.
      menu={
        onClick ? (
          <EntityRowActions
            actions={[
              {
                key: 'view',
                label: t('integrations.viewDetails'),
                icon: Eye,
                onClick,
              },
              ...(onExport
                ? [
                    {
                      key: 'export',
                      label: tCommon('actions.export'),
                      icon: Download,
                      onClick: onExport,
                    } satisfies EntityRowAction,
                  ]
                : []),
              ...(onDuplicate
                ? [
                    {
                      key: 'duplicate',
                      label: tCommon('actions.duplicate'),
                      icon: Copy,
                      onClick: onDuplicate,
                    } satisfies EntityRowAction,
                  ]
                : []),
            ]}
            ariaLabel={t('integrations.menuLabel', { name: title })}
          />
        ) : undefined
      }
    />
  );
}
