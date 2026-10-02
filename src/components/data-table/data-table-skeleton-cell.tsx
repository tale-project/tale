'use client';

import { Badge, type BadgeProps } from '@tale/ui/badge';
import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { CopyableText } from '@tale/ui/copyable-field';
import { useT } from '@tale/ui/i18n/client';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';

export interface DataTableSkeleton {
  type?:
    | 'text'
    | 'two-line'
    | 'badge'
    | 'badge-text'
    | 'text-badge'
    | 'id-copy'
    | 'avatar-text'
    | 'icon-text'
    | 'icon'
    | 'action'
    | 'checkbox'
    | 'switch';
  /** Use the real icon component so its footprint stays in sync. */
  icon?: ReactNode;
  iconGap?: 2 | 3;
  badge?: Pick<BadgeProps, 'variant' | 'className'>;
  /** Icon and avatar cells may carry a caption below their primary label. */
  lines?: 1 | 2;
  /** Match the spacing between primary and secondary text. */
  lineGap?: 0 | 0.5 | 1;
  /** Compact action clusters use the same button size and count as their row. */
  actionSize?: 'default' | 'sm';
  actionCount?: number;
}

interface DataTableSkeletonCellProps {
  skeleton?: DataTableSkeleton;
  align?: 'left' | 'center' | 'right';
  rowIndex: number;
  columnIndex: number;
}

/**
 * Unknown values need estimated widths, but controls and line boxes have known
 * dimensions. Render the same primitives as loaded cells so their height and
 * shape cannot drift when the design system changes.
 */
export function DataTableSkeletonCell({
  skeleton,
  align,
  rowIndex,
  columnIndex,
}: DataTableSkeletonCellProps) {
  const { t } = useT('common');
  const type = skeleton?.type ?? 'text';
  const seed = rowIndex * 17 + columnIndex * 29;
  const primaryWidth = `${62 + (seed % 31)}%`;
  const secondaryWidth = `${38 + (seed % 25)}%`;
  const lineGap = skeleton?.lineGap ?? 0;
  const textLines = (
    <Stack
      gap={lineGap === 0.5 ? 0 : lineGap}
      className={cn('min-w-0 flex-1', lineGap === 0.5 && 'gap-0.5')}
    >
      <Text
        as="div"
        variant="label"
        className="max-w-48"
        style={{ width: primaryWidth }}
      >
        <SkeletonText seed={seed} />
      </Text>
      {(type === 'two-line' || skeleton?.lines === 2) && (
        <Text
          as="div"
          variant="caption"
          className="max-w-24"
          style={{ width: secondaryWidth }}
        >
          <SkeletonText seed={seed + 1} />
        </Text>
      )}
    </Stack>
  );
  const icon = (
    <SkeletonBox asChild>
      <span className="inline-flex shrink-0 rounded">
        {skeleton?.icon ?? (
          <span className={type === 'avatar-text' ? 'size-8' : 'size-4'} />
        )}
      </span>
    </SkeletonBox>
  );

  let content: ReactNode;
  if (type === 'action') {
    content = (
      <HStack gap={1}>
        {Array.from({ length: skeleton?.actionCount ?? 1 }, (_, index) => (
          <IconButton
            key={index}
            size={skeleton?.actionSize}
            icon={MoreVertical}
            aria-label={t('aria.rowActions')}
          />
        ))}
      </HStack>
    );
  } else if (type === 'checkbox') {
    content = <Checkbox aria-label={t('aria.selectRow')} />;
  } else if (type === 'switch') {
    content = <Switch aria-label={t('actions.loading')} />;
  } else if (
    type === 'badge' ||
    type === 'badge-text' ||
    type === 'text-badge'
  ) {
    const badge = (
      <Badge
        variant={skeleton?.badge?.variant}
        className={cn('w-20 max-w-full', skeleton?.badge?.className)}
      >
        {'\u00a0'}
      </Badge>
    );
    content =
      type === 'badge' ? (
        badge
      ) : (
        <Stack
          gap={lineGap === 0.5 ? 0 : lineGap}
          className={cn('min-w-0 flex-1', lineGap === 0.5 && 'gap-0.5')}
        >
          {type === 'text-badge' ? (
            <HStack gap={2}>
              <div className="min-w-0 flex-1">
                <SkeletonText seed={seed} />
              </div>
              {badge}
            </HStack>
          ) : (
            badge
          )}
          {(type === 'badge-text' || skeleton?.lines === 2) && (
            <Text as="div" variant="caption" style={{ width: secondaryWidth }}>
              <SkeletonText seed={seed + 1} />
            </Text>
          )}
        </Stack>
      );
  } else if (type === 'id-copy') {
    content = (
      <SkeletonBox>
        <CopyableText value="00000000-0000" />
      </SkeletonBox>
    );
  } else if (type === 'icon') {
    content = icon;
  } else if (type === 'avatar-text' || type === 'icon-text') {
    content = (
      <HStack
        gap={skeleton?.iconGap ?? (type === 'avatar-text' ? 3 : 2)}
        className="min-w-0 flex-1"
      >
        {icon}
        {textLines}
      </HStack>
    );
  } else if (type === 'two-line') {
    content = textLines;
  } else {
    content = (
      <div
        className={cn(
          align && 'max-w-20',
          align === 'right' && 'ml-auto',
          align === 'center' && 'mx-auto',
        )}
        style={{ width: align ? '100%' : `${52 + (seed % 38)}%` }}
      >
        <SkeletonText seed={seed} />
      </div>
    );
  }

  // Keep inline controls in the cell's own line box. A flex wrapper here
  // changes their baseline and makes even correctly sized masks jump on load.
  return content;
}
