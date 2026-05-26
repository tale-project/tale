'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useT } from '@/lib/i18n/client';

import { SkillRowActions } from '../components/skill-row-actions';
import type { SkillRow } from '../components/skills-table';

interface SkillsTableConfig {
  columns: ColumnDef<SkillRow>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

export interface SkillsTableBindingMode {
  selected: string[];
  onChange: (slugs: string[]) => void;
  max: number;
}

interface SkillsTableConfigOptions {
  organizationId: string;
  onDeleted?: () => void;
  bindingMode?: SkillsTableBindingMode;
}

export function useSkillsTableConfig({
  organizationId,
  onDeleted,
  bindingMode,
}: SkillsTableConfigOptions): SkillsTableConfig {
  const { t } = useT('settings');

  const selectedSet = useMemo(
    () => new Set(bindingMode?.selected ?? []),
    [bindingMode?.selected],
  );
  const atCap = bindingMode
    ? bindingMode.selected.length >= bindingMode.max
    : false;

  const columns = useMemo<ColumnDef<SkillRow>[]>(
    () => [
      ...(bindingMode
        ? [
            {
              id: 'binding',
              header: '',
              meta: { isAction: true },
              cell: ({ row }) => {
                const slug = row.original.slug;
                const checked = selectedSet.has(slug);
                const disabled =
                  Boolean(row.original.status) || (!checked && atCap);
                return (
                  <HStack
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      aria-label={t('agents.form.skillBindingsToggleAria', {
                        defaultValue: 'Bind {slug}',
                        slug,
                      })}
                      onCheckedChange={() => {
                        if (checked) {
                          bindingMode.onChange(
                            bindingMode.selected.filter((s) => s !== slug),
                          );
                        } else if (!atCap) {
                          bindingMode.onChange([...bindingMode.selected, slug]);
                        }
                      }}
                    />
                  </HStack>
                );
              },
              size: 48,
            } satisfies ColumnDef<SkillRow>,
          ]
        : []),
      {
        id: 'name',
        header: t('skills.columns.name', { defaultValue: 'Skill' }),
        meta: { hasAvatar: false },
        cell: ({ row }) => (
          <Stack gap={1}>
            <Text as="span" variant="label">
              {row.original.name}
            </Text>
            {row.original.status ? (
              <HStack gap={1} align="center">
                <AlertTriangle className="text-destructive size-3.5" />
                <Text as="span" variant="caption" className="text-destructive">
                  {row.original.message ??
                    t('skills.columns.loadError', {
                      defaultValue: 'Failed to read SKILL.md',
                    })}
                </Text>
              </HStack>
            ) : null}
          </Stack>
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
      ...(bindingMode
        ? []
        : [
            {
              id: 'actions',
              header: '',
              meta: { isAction: true },
              cell: ({ row }) => (
                <HStack
                  gap={1}
                  justify="end"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <SkillRowActions
                    skillSlug={row.original.slug}
                    organizationId={organizationId}
                    expectedHash={row.original.hash}
                    onDeleted={onDeleted}
                  />
                </HStack>
              ),
              size: 60,
            } satisfies ColumnDef<SkillRow>,
          ]),
    ],
    [t, organizationId, onDeleted, bindingMode, selectedSet, atCap],
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
