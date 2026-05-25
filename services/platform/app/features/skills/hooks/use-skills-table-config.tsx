'use client';

import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { SkillRowActions } from '../components/skill-row-actions';
import type { SkillRow } from '../components/skills-table';

interface SkillsTableConfig {
  columns: ColumnDef<SkillRow>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

interface SkillsTableConfigOptions {
  organizationId: string;
  onDeleted?: () => void;
}

export function useSkillsTableConfig({
  organizationId,
  onDeleted,
}: SkillsTableConfigOptions): SkillsTableConfig {
  const { t } = useT('settings');

  const columns = useMemo<ColumnDef<SkillRow>[]>(
    () => [
      {
        id: 'name',
        header: t('skills.columns.name', { defaultValue: 'Skill' }),
        meta: { hasAvatar: false },
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.name}
          </Text>
        ),
        size: 220,
      },
      {
        id: 'description',
        header: t('skills.columns.description', {
          defaultValue: 'Description',
        }),
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="line-clamp-2">
            {row.original.description}
          </Text>
        ),
        size: 400,
      },
      {
        id: 'deps',
        header: () => (
          <span className="block w-full text-right">
            {t('skills.columns.deps', { defaultValue: 'Deps' })}
          </span>
        ),
        size: 120,
        meta: {
          headerLabel: t('skills.columns.deps', { defaultValue: 'Deps' }),
          align: 'right',
        },
        cell: ({ row }) => {
          const r = row.original;
          const total =
            (r.toolNames?.length ?? 0) +
            (r.integrationBindings?.length ?? 0) +
            (r.workflowBindings?.length ?? 0);
          if (total === 0) {
            return (
              <Text as="span" variant="muted" className="block text-right">
                —
              </Text>
            );
          }
          return (
            <HStack gap={1} justify="end">
              <Badge variant="outline">{total}</Badge>
            </HStack>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <SkillRowActions
              skillSlug={row.original.slug}
              organizationId={organizationId}
              onDeleted={onDeleted}
            />
          </HStack>
        ),
        size: 60,
      },
    ],
    [t, organizationId, onDeleted],
  );

  return {
    columns,
    searchPlaceholder: t('skills.searchPlaceholder', {
      defaultValue: 'Search skills…',
    }),
    stickyLayout: true,
    pageSize: 20,
  };
}
