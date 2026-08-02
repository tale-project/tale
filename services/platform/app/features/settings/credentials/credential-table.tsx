'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ACTIONS_COLUMN_SIZE } from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { CredentialAddDialog } from './credential-add-dialog';
import { CredentialRowActions } from './credential-row-actions';
import { VendorIcon } from './vendor-icon';

const PAGE_SIZE = 25;

/** The per-surface copy the shared table cannot name for itself. */
export interface CredentialTableLabels {
  /** Header of the vendor column ("Provider" / "Connector"). */
  vendorColumn: string;
  /** Title of the vendor facet in the filter panel. */
  vendorFilter: string;
  /** Placeholder for the catalog search inside the add dialog. */
  catalogSearch: string;
  /** Shown when the organization holds no credentials at all. */
  empty: { icon: LucideIcon; title: string; description: string };
  /**
   * Shown in the picker when the DEPLOYMENT ships no vendors — a mounting or
   * permissions problem on the config root, not an empty organization. The two
   * read identically from the table alone, which is why they are two strings.
   */
  catalogEmpty: string;
}

/**
 * One table row: a stored credential, joined to the catalog entry it
 * authenticates against.
 *
 * `vendorName` is flattened onto the row rather than read through `vendor`
 * because the search runs over row FIELDS — an operator typing "openai" is
 * looking for the vendor as readily as for the label they gave the key.
 */
interface CredentialTableRow<V, Cred> {
  id: string;
  name: string;
  vendorKey: string;
  vendorName: string;
  vendor: V | null;
  credential: Cred;
}

/**
 * The organization's credentials for one surface, as a table.
 *
 * A flat list of credentials rather than a grid of vendors: what an operator
 * manages here is the keys they hold — which one is the default, which is
 * disabled, which needs re-consent — and a card per shipped vendor buried that
 * under a dozen tiles for vendors nobody had configured. The catalog did not
 * disappear; it moved behind "Add credential", where choosing a vendor is the
 * first step of the one flow that needs it.
 *
 * A row whose vendor is no longer in the catalog still lists — under its stored
 * slug, with the actions that still make sense. Hiding it would hide a live
 * secret.
 */
export function CredentialTable<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  vendors,
  credentials,
  adapter,
  isLoading,
  labels,
  vendorFilter,
  onVendorFilterChange,
}: {
  organizationId: string;
  /** The whole shipped catalog — the join source and the picker's contents. */
  vendors: readonly V[];
  credentials: readonly Cred[];
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  isLoading: boolean;
  /**
   * The strings only the surface can name (its vendor noun, its empty state).
   *
   * Resolved by the caller rather than looked up here from `adapter.ns`: a
   * `t(\`${ns}.vendorColumn\`)` is invisible to the i18n usage check, which is
   * exactly how a key gets deleted from a catalog while a page still asks for
   * it. Literal keys at the two call sites keep that check honest.
   */
  labels: CredentialTableLabels;
  /** Selected vendor keys. Owned by the page so a `?vendor=` link can seed it. */
  vendorFilter: string[];
  onVendorFilterChange: (next: string[]) => void;
}) {
  const { t } = useT('settings');
  const [addOpen, setAddOpen] = useState(false);

  const vendorsByKey = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.key, vendor])),
    [vendors],
  );

  const inUseKeys = useMemo(
    () =>
      new Set(credentials.map((credential) => adapter.vendorKeyOf(credential))),
    [adapter, credentials],
  );

  const rows = useMemo(() => {
    const all: CredentialTableRow<V, Cred>[] = credentials.map((credential) => {
      const vendorKey = adapter.vendorKeyOf(credential);
      const vendor = vendorsByKey.get(vendorKey) ?? null;
      return {
        id: credential.id,
        name: credential.name,
        vendorKey,
        // A vendor that left the catalog has no display name left to show, so
        // the stored slug stands in — it is what the operator will grep for.
        vendorName: vendor?.displayName ?? vendorKey,
        vendor,
        credential,
      };
    });
    if (vendorFilter.length === 0) return all;
    return all.filter((row) => vendorFilter.includes(row.vendorKey));
  }, [adapter, credentials, vendorFilter, vendorsByKey]);

  /**
   * Vendors holding usable credentials of which none is the default.
   *
   * `isDefault` is per (organization, vendor), so this is a per-vendor
   * question — and a silent one: a call that names no credential simply cannot
   * pick one. The old per-vendor dialog said so on the spot; a flat table has
   * to gather it up, or the warning disappears with the dialog.
   */
  const vendorsWithoutDefault = useMemo(() => {
    const active = new Map<string, boolean>();
    for (const credential of credentials) {
      if (credential.status === 'disabled') continue;
      const key = adapter.vendorKeyOf(credential);
      active.set(key, (active.get(key) ?? false) || credential.isDefault);
    }
    return [...active.entries()]
      .filter(([, hasDefault]) => !hasDefault)
      .map(([key]) => vendorsByKey.get(key)?.displayName ?? key)
      .sort((a, b) => a.localeCompare(b));
  }, [adapter, credentials, vendorsByKey]);

  // Only vendors actually represented in the table are worth offering: a facet
  // that can only ever narrow to zero rows is noise.
  const vendorFacets = useMemo(() => {
    const seen = new Map<string, string>();
    for (const credential of credentials) {
      const key = adapter.vendorKeyOf(credential);
      if (!seen.has(key)) {
        seen.set(key, vendorsByKey.get(key)?.displayName ?? key);
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [adapter, credentials, vendorsByKey]);

  const filterConfigs: FilterConfig[] =
    vendorFacets.length > 1
      ? [
          {
            key: 'vendor',
            title: labels.vendorFilter,
            options: vendorFacets,
            selectedValues: vendorFilter,
            onChange: onVendorFilterChange,
            multiSelect: true,
          },
        ]
      : [];

  const columns = useMemo<ColumnDef<CredentialTableRow<V, Cred>>[]>(() => {
    return [
      {
        id: 'name',
        accessorKey: 'name',
        header: t('credentials.columns.name'),
        cell: ({ row }) => {
          const { credential } = row.original;
          const status = adapter.statusLabel(t, credential.status);
          const detail = adapter.detailLine?.(
            t,
            credential,
            row.original.vendor,
          );
          return (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground truncate text-sm font-medium">
                  {credential.name}
                </span>
                {credential.isDefault && (
                  <Badge variant="blue">{t('credentials.default')}</Badge>
                )}
                {status !== null && (
                  <Badge variant={adapter.statusTone(credential.status)}>
                    {status}
                  </Badge>
                )}
              </div>
              {detail !== undefined && detail !== null && (
                <Text as="p" variant="muted" className="text-xs">
                  {detail}
                </Text>
              )}
            </div>
          );
        },
      },
      {
        id: 'vendor',
        accessorKey: 'vendorName',
        header: labels.vendorColumn,
        size: 200,
        cell: ({ row }) => (
          <HStack align="center" gap={2} className="min-w-0">
            <VendorIcon
              iconUrl={row.original.vendor?.iconUrl}
              className="size-4"
            />
            <span className="truncate text-sm">{row.original.vendorName}</span>
          </HStack>
        ),
      },
      {
        id: 'method',
        header: t('credentials.columns.method'),
        size: 160,
        cell: ({ row }) => (
          <span className="text-sm">
            {adapter.methodLabel(t, row.original.credential.authMethod)}
          </span>
        ),
      },
      {
        id: 'actions',
        // Visually hidden, but a `<th>` with no discernible text is a WCAG
        // failure — the column still has to name itself to a screen reader.
        header: () => (
          <span className="sr-only">{t('credentials.columns.actions')}</span>
        ),
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <CredentialRowActions
              organizationId={organizationId}
              credential={row.original.credential}
              vendor={row.original.vendor}
              adapter={adapter}
            />
          </HStack>
        ),
      },
    ];
  }, [adapter, labels.vendorColumn, organizationId, t]);

  const list = useListPage<CredentialTableRow<V, Cred>>({
    dataSource: { type: 'query', data: isLoading ? undefined : rows },
    pageSize: PAGE_SIZE,
    search: {
      fields: ['name', 'vendorName'],
      placeholder: t('credentials.searchPlaceholder'),
    },
    filters: {
      configs: filterConfigs,
      onClear: () => onVendorFilterChange([]),
    },
    getRowId: (row) => row.id,
    entityLabel: {
      one: t('credentials.entityLabelOne'),
      other: t('credentials.entityLabel'),
    },
  });

  return (
    <>
      {vendorsWithoutDefault.length > 0 && (
        <Alert
          variant="warning"
          description={t('credentials.noDefault', {
            vendors: vendorsWithoutDefault.join(', '),
          })}
          className="mb-4"
        />
      )}

      <DataTable
        columns={columns}
        emptyState={labels.empty}
        addAction={{
          label: t('credentials.addCredential'),
          icon: Plus,
          onClick: () => setAddOpen(true),
        }}
        {...list.tableProps}
      />

      {/* Mounted only while open: the picker holds draft secret material, and a
          closed dialog has no business keeping it in memory. */}
      {addOpen && (
        <CredentialAddDialog
          organizationId={organizationId}
          vendors={vendors}
          inUseKeys={inUseKeys}
          adapter={adapter}
          open={addOpen}
          onOpenChange={setAddOpen}
          searchPlaceholder={labels.catalogSearch}
          catalogEmpty={labels.catalogEmpty}
        />
      )}
    </>
  );
}
