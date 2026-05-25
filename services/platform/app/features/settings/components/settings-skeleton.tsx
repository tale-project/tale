'use client';

import { Skeleton } from '@tale/ui/skeleton';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { cn } from '@/lib/utils/cn';

// =============================================================================
// Shared skeleton primitives — mirror the layout of `<SettingsPage>`,
// `<SettingsSection>`, `<SettingsField>`, `<SettingsRow>` exactly so the
// swap from skeleton → real content doesn't shift the layout.
//
// Per-page skeletons (AccountPageSkeleton, OrganizationPageSkeleton, …)
// live in each feature folder and compose these primitives.
// =============================================================================

interface BaseSkeletonProps {
  className?: string;
}

const widthClassMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  full: 'w-full',
} as const;

type FieldWidth = keyof typeof widthClassMap;

/**
 * Field skeleton — mirrors `<SettingsField>` and the platform `<Input>`:
 *  outer `flex flex-col gap-1.5`, label `h-3.5` (Label leading-none),
 *  control `h-10` (default Input height), optional description `h-4`.
 */
export function SettingsFieldSkeleton({
  className,
  width = 'sm',
  withDescription = false,
}: BaseSkeletonProps & {
  width?: FieldWidth;
  withDescription?: boolean;
}) {
  return (
    <div
      className={cn('flex flex-col gap-1.5', widthClassMap[width], className)}
    >
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-10 w-full" />
      {withDescription && <Skeleton className="h-4 w-48" />}
    </div>
  );
}

/**
 * Textarea-shaped field. Same outer as `SettingsFieldSkeleton` but with a
 * taller body (default 4 rows ≈ 96px → `h-24`).
 */
export function SettingsTextareaFieldSkeleton({
  className,
  width = 'full',
  rows = 4,
}: BaseSkeletonProps & {
  width?: FieldWidth;
  rows?: number;
}) {
  const heightPx = Math.max(96, rows * 24);
  return (
    <div
      className={cn('flex flex-col gap-1.5', widthClassMap[width], className)}
    >
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="w-full" style={{ height: heightPx }} />
    </div>
  );
}

/**
 * Row skeleton — mirrors `<SettingsRow>`:
 *  outer `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between
 *  sm:gap-6`, left label `h-3.5`, left description `h-4`, right control `h-9`.
 */
export function SettingsRowSkeleton({
  className,
  controlWidth = 'w-28',
}: BaseSkeletonProps & {
  /** Tailwind width class for the right-side control placeholder. */
  controlWidth?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className={cn('h-9 shrink-0', controlWidth)} />
    </div>
  );
}

/**
 * Switch row — same structure as `<SettingsRow>` but with a switch-shaped
 * control (h-5 w-9) so the height matches the Radix switch primitive.
 */
export function SettingsSwitchRowSkeleton({ className }: BaseSkeletonProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
    </div>
  );
}

interface SettingsSectionSkeletonProps extends BaseSkeletonProps {
  /** Optional explicit body content (overrides `rows`/`variant`). */
  children?: React.ReactNode;
  /** Number of field/row placeholders if `children` is not provided. */
  rows?: number;
  /** Whether the auto-generated body is field-shaped or row-shaped. */
  variant?: 'fields' | 'rows';
  /** Hide the section header (title + description). */
  hideHeader?: boolean;
}

/**
 * Section skeleton — mirrors `<SettingsSection>`:
 *  outer `flex flex-col gap-5`, header `flex flex-col gap-1` with h2 (`h-5`)
 *  and description (`h-5`).
 */
export function SettingsSectionSkeleton({
  rows = 2,
  variant = 'fields',
  hideHeader = false,
  children,
  className,
}: SettingsSectionSkeletonProps) {
  const Row = variant === 'rows' ? SettingsRowSkeleton : SettingsFieldSkeleton;
  return (
    <section className={cn('flex flex-col gap-5', className)}>
      {!hideHeader && (
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
      )}
      {children ?? Array.from({ length: rows }).map((_, i) => <Row key={i} />)}
    </section>
  );
}

interface SettingsPageSkeletonProps extends BaseSkeletonProps {
  /** Children (typically `<SettingsSectionSkeleton>` instances). */
  children?: React.ReactNode;
  /** When no children are supplied, render N generic section skeletons. */
  sections?: number;
  /** Hide the page header (use when wrapping inside an existing `<SettingsPage>`). */
  hideHeader?: boolean;
  /** Right-aligned action placeholder (mirrors `<SettingsPage headerAction>`). */
  headerAction?: React.ReactNode;
}

/**
 * Page skeleton — mirrors `<SettingsPage>`:
 *  outer `flex flex-col gap-8`, header `flex flex-col gap-3 sm:flex-row …`
 *  with h1 (`h-6`) + description (`h-5`) and optional right-aligned action
 *  cluster, then children stacked at `gap-8`.
 */
export function SettingsPageSkeleton({
  sections = 2,
  hideHeader = false,
  headerAction,
  children,
  className,
}: SettingsPageSkeletonProps) {
  return (
    <div className={cn('flex w-full flex-col gap-8', className)}>
      {!hideHeader && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-80 max-w-full" />
          </div>
          {headerAction && (
            <div className="flex shrink-0 items-center justify-end">
              {headerAction}
            </div>
          )}
        </header>
      )}
      <div className="flex flex-col gap-8">
        {children ??
          Array.from({ length: sections }).map((_, i) => (
            <SettingsSectionSkeleton key={i} />
          ))}
      </div>
    </div>
  );
}

/**
 * Generic settings-table skeleton — uses the real `DataTableSkeleton` so the
 * search row, header heights, cell padding and outer border match the
 * production `<DataTable>` (no layout shift on swap). Used by API keys /
 * Providers / Members / Teams / Trash list pages.
 *
 * For tables with custom columns (e.g. audit logs), prefer rendering
 * `DataTableSkeleton` directly with the real `ColumnDef[]` so column widths
 * line up exactly.
 */
export function SettingsTableSkeleton({
  rows = 5,
  className,
}: BaseSkeletonProps & { rows?: number }) {
  return (
    <DataTableSkeleton
      className={className}
      rows={rows}
      searchPlaceholder=" "
      columns={[
        { skeleton: { type: 'avatar-text' } },
        { skeleton: { type: 'text' } },
        { skeleton: { type: 'badge' } },
        { isAction: true, size: 56 },
      ]}
    />
  );
}

/**
 * Tab strip skeleton — matches `<Tabs>` headers (People / Integrations).
 * Renders N pill-shaped tab placeholders aligned left.
 */
export function SettingsTabsSkeleton({
  tabs = 2,
  className,
}: BaseSkeletonProps & { tabs?: number }) {
  return (
    <div className={cn('border-border flex gap-6 border-b', className)}>
      {Array.from({ length: tabs }).map((_, i) => (
        <Skeleton key={i} className="my-2 h-5 w-20" />
      ))}
    </div>
  );
}

/**
 * Settings list page — search + table inside `<SettingsPage>`. Used by
 * API keys, Providers, and other plain list-shaped pages.
 */
export function SettingsListPageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SettingsPageSkeleton>
      <SettingsTableSkeleton rows={rows} />
    </SettingsPageSkeleton>
  );
}
