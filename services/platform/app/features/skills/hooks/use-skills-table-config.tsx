'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useT } from '@/lib/i18n/client';

import type { SkillRow } from '../lib/skill-rows';
import {
  resolveSkillLoadErrorPresentation,
  skillLoadErrorSummaryKey,
} from '../utils/skill-load-error';

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
  bindingMode: SkillsTableBindingMode;
}

/**
 * Column config for the agent-binding skills table: a single-purpose binding
 * checkbox plus the name/description columns. Org-level skill MANAGEMENT
 * (upload/duplicate/delete) lives in the Skills settings catalog, not here.
 */
export function useSkillsTableConfig({
  bindingMode,
}: SkillsTableConfigOptions): SkillsTableConfig {
  const { t } = useT('settings');

  const selectedSet = useMemo(
    () => new Set(bindingMode.selected),
    [bindingMode.selected],
  );
  const atCap = bindingMode.selected.length >= bindingMode.max;

  const columns = useMemo<ColumnDef<SkillRow>[]>(
    () => [
      {
        id: 'binding',
        header: '',
        meta: { isAction: true },
        cell: ({ row }) => {
          const slug = row.original.slug;
          const checked = selectedSet.has(slug);
          const hasError = Boolean(row.original.status);
          const blockedByCap = !checked && atCap;
          const disabled = hasError || blockedByCap;
          // Anchor for AT: error rows describe themselves via the
          // visible error text in the name cell; at-cap rows reach a
          // shared sr-only line. Keeping the checkbox focusable via
          // aria-disabled (not the native `disabled` attr) lets users
          // tab to a blocked row and hear why.
          const describedBy = hasError
            ? `skill-binding-error-${slug}`
            : blockedByCap
              ? 'skill-binding-at-cap-reason'
              : undefined;
          return (
            <HStack
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={checked}
                aria-disabled={disabled || undefined}
                aria-describedby={describedBy}
                aria-label={t('agents.form.skillBindingsToggleAria', {
                  defaultValue: 'Bind {slug}',
                  slug,
                })}
                onCheckedChange={() => {
                  if (disabled) return;
                  if (checked) {
                    bindingMode.onChange(
                      bindingMode.selected.filter((s) => s !== slug),
                    );
                  } else {
                    bindingMode.onChange([...bindingMode.selected, slug]);
                  }
                }}
              />
            </HStack>
          );
        },
        size: 48,
      },
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
              <HStack gap={1} align="start">
                <AlertTriangle
                  className="text-destructive mt-0.5 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <Text
                  as="span"
                  id={`skill-binding-error-${row.original.slug}`}
                  variant="caption"
                  className="text-destructive line-clamp-2"
                  title={row.original.message}
                >
                  {(() => {
                    const presentation = resolveSkillLoadErrorPresentation(
                      row.original.status,
                      row.original.message,
                    );
                    const key = skillLoadErrorSummaryKey(presentation);
                    return presentation.line != null
                      ? t(key, {
                          line: presentation.line,
                          defaultValue: 'YAML syntax error (line {line})',
                        })
                      : t(key, {
                          defaultValue: 'Failed to read SKILL.md',
                        });
                  })()}
                </Text>
              </HStack>
            ) : null}
          </Stack>
        ),
        size: 200,
      },
      {
        id: 'description',
        header: t('skills.columns.description', {
          defaultValue: 'Description',
        }),
        // The description flexes (absorbs the container slack) instead of the
        // name column, and its `size` is only the readable minimum — this
        // table renders inside the agent form's NARROW content column,
        // where the previous 400px floor forced horizontal overflow and the
        // text looked cut off at the container edge.
        meta: { flex: true },
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="line-clamp-2">
            {row.original.description}
          </Text>
        ),
        size: 200,
      },
    ],
    [t, bindingMode, selectedSet, atCap],
  );

  return {
    columns,
    searchPlaceholder: t('skills.searchPlaceholder', {
      defaultValue: 'Search skills…',
    }),
    // Non-sticky (like the agents/providers lists): the DataTable renders a
    // bordered frame contained at the page width and the page owns the single
    // vertical scroll. Sticky layout needs a bounded-height ancestor to drive
    // its own inner scroll container; this table renders under the agent
    // Skills tab without that chain, so a sticky inner `overflow-auto`
    // collapsed to content height and its `overscroll-contain` swallowed the
    // wheel over the table — scrolling only worked outside it.
    stickyLayout: false,
    pageSize: 20,
  };
}
