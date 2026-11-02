import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import {
  TableIconCell,
  tableIconCellSkeleton,
} from '@tale/ui/data-table/table-icon-cell';
import { HStack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { NoValue } from '@/app/components/no-value';
import { TABLE_LINK_CLASS } from '@/app/lib/table-link';
import type { SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import {
  SecretRowActions,
  type ReturnPoint,
} from '../components/secret-row-actions';
import { KIND_ICONS } from '../lib/kinds';
import { useSecretLabels } from './use-secret-labels';

/**
 * What each column needs to show what it holds in one line, in the longest
 * words of the three languages ("Informations personnelles", "Toutes les
 * sessions", "il y a quelques secondes": measured, with the 24px each cell
 * pads it with). A title or the name of a session is the person's own text and
 * can be longer: it is cut short, and its whole is the `title` of the cell
 * (and the secret's own dialog).
 *
 * The table gives each column these sizes at the least, and every pixel more
 * to the details, the one column of prose. `SECRETS_TABLE_MIN_WIDTH` is what
 * the columns add up to (932 of the 940px a laptop window of 1024px leaves the
 * table); a column narrower than that has the compact row instead of a
 * scrollbar that would take the menu of the row out of sight.
 */
const SIZE = {
  title: 240,
  kind: 194,
  scope: 154,
  /** The least the details have: what is more than the others need goes to them. */
  preview: 100,
  /** "il y a quelques secondes", the longest of what a fresh change reads. */
  updated: 188,
} as const;

/** The most the name of a session gets over `SIZE.scope`: "Competitor research" in full. */
const SCOPE_GROWTH_MAX = 46;

/** A table has room to spare for the name of a session beyond this width. */
const SCOPE_GROWS_FROM = 1000;

/**
 * A wide table has room to spare, and all of it would go to the details. The
 * name of a session is the person's own word, a normal one longer than the
 * column above: beyond `SCOPE_GROWS_FROM` of table it gets half of each pixel
 * more, up to `SCOPE_GROWTH_MAX`. The details get the other half, then
 * everything, so they never have less in a wider table than in a narrower one,
 * and nothing jumps as a window is dragged.
 */
export function scopeGrowth(tableWidth: number): number {
  return Math.min(
    SCOPE_GROWTH_MAX,
    Math.max(0, Math.round((tableWidth - SCOPE_GROWS_FROM) / 2)),
  );
}

export const SECRETS_TABLE_MIN_WIDTH =
  SIZE.title +
  SIZE.kind +
  SIZE.scope +
  SIZE.preview +
  SIZE.updated +
  ACTIONS_COLUMN_SIZE;

interface SecretsColumnsOptions {
  /** The column is too narrow for the columns: the title carries the type and who it is for, and the rest are left out. */
  compact: boolean;
  /** What a wide table adds to the column of who a secret is for, in px (`scopeGrowth`). */
  scopeGrowth: number;
  /** Each handler gets the control of the row the person used, to give the focus back to. */
  onView: (secret: SecretSummary, returnTo: ReturnPoint) => void;
  onEdit: (secret: SecretSummary, returnTo: ReturnPoint) => void;
  onDelete: (secret: SecretSummary, returnTo: ReturnPoint) => void;
}

/** A click on a control of the row is that control's, not the row's. */
const stop = (event: { stopPropagation: () => void }) =>
  event.stopPropagation();

/**
 * The columns of the secrets list. The first cell is the row's named control,
 * a button that opens the secret (the row's own click does the same, for a
 * pointer). Nothing here ever shows a hidden value: a row only has what the
 * list endpoint returns.
 */
export function useSecretsColumns({
  compact,
  scopeGrowth: scopeExtra,
  onView,
  onEdit,
  onDelete,
}: SecretsColumnsOptions): ColumnDef<SecretSummary>[] {
  const { t } = useT('secrets');
  const labels = useSecretLabels();

  return useMemo<ColumnDef<SecretSummary>[]>(() => {
    // The compact row has one column of content: nothing to give room to.
    const title: ColumnDef<SecretSummary> = {
      accessorKey: 'title',
      header: t('table.columns.title'),
      size: SIZE.title,
      meta: { skeleton: tableIconCellSkeleton({ lines: compact ? 2 : 1 }) },
      cell: ({ row }) => {
        const secret = row.original;
        const Icon = KIND_ICONS[secret.kind];
        return (
          <TableIconCell
            icon={<Icon />}
            label={
              <button
                type="button"
                onClick={(event) => {
                  stop(event);
                  onView(secret, { current: event.currentTarget });
                }}
                title={secret.title}
                className={cn(
                  TABLE_LINK_CLASS,
                  'truncate text-left text-sm font-medium',
                )}
              >
                {secret.title}
              </button>
            }
            caption={compact ? labels.summary(secret) : undefined}
          />
        );
      },
    };

    const actions: ColumnDef<SecretSummary> = {
      id: 'actions',
      header: '',
      size: ACTIONS_COLUMN_SIZE,
      meta: { isAction: true },
      cell: ({ row }) => (
        <HStack justify="end" onClick={stop}>
          <SecretRowActions
            secret={row.original}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </HStack>
      ),
    };

    if (compact) return [title, actions];

    return [
      title,
      {
        id: 'kind',
        header: t('table.columns.type'),
        size: SIZE.kind,
        meta: { skeleton: { type: 'badge' } },
        cell: ({ row }) => (
          <Badge variant="slate">{labels.kind(row.original.kind)}</Badge>
        ),
      },
      {
        id: 'scope',
        header: t('table.columns.scope'),
        size: SIZE.scope + scopeExtra,
        cell: ({ row }) => {
          const { session } = row.original;
          return session === null ? (
            <Text as="span" variant="muted" truncate className="block">
              {t('scope.everySession')}
            </Text>
          ) : (
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: String(session.id) }}
              onClick={stop}
              title={session.name}
              className={cn(TABLE_LINK_CLASS, 'block truncate text-sm')}
            >
              {session.name}
            </Link>
          );
        },
      },
      {
        accessorKey: 'preview',
        header: t('table.columns.details'),
        size: SIZE.preview,
        // The one column that takes the room the others leave.
        meta: { flex: true },
        cell: ({ row }) =>
          row.original.preview === '' ? (
            <Text as="span" variant="muted">
              <NoValue label={t('table.noDetails')} />
            </Text>
          ) : (
            <Text
              as="span"
              variant="muted"
              truncate
              className="block"
              title={row.original.preview}
            >
              {row.original.preview}
            </Text>
          ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('table.columns.updated'),
        size: SIZE.updated,
        cell: ({ row }) => (
          // Never over the menu of the row: a phrase longer than the column
          // is cut short, not carried into the next cell.
          <TableDateCell
            date={row.original.updatedAt}
            preset="relative"
            className="block truncate"
          />
        ),
      },
      actions,
    ];
  }, [t, labels, compact, scopeExtra, onView, onEdit, onDelete]);
}
