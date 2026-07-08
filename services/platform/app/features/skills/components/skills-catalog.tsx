'use client';

import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Copy, Download, Eye, Search, Sparkles, Trash2 } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CatalogGridSkeleton } from '@/app/components/catalog/catalog-card-skeleton';
import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { useCatalogSearch } from '@/app/components/catalog/use-catalog-search';
import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';
import { EntityRowActions } from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { downloadBase64File } from '@/lib/utils/download';

import { useDuplicateSkill, useExportSkill } from '../hooks/mutations';
import { useListSkills } from '../hooks/queries';
import { toSkillRows, type SkillRow } from '../lib/skill-rows';
import { SkillDeleteDialog } from './skill-delete-dialog';
import { SkillDetailPanel } from './skill-detail-panel';
import { SkillIcon } from './skill-icon';

interface SkillsCatalogProps {
  organizationId: string;
  /** Pre-opens the detail panel for this slug on mount (used by ?slug= deep-link). */
  initialDetailSlug?: string | null;
  /** The "Add skill" control, hosted beside the toolbar search (and in the
   *  empty state, so a first skill is still one click away). */
  action?: ReactNode;
}

/** Search matches a skill's name, slug, or description. */
function skillHaystack(row: SkillRow): ReadonlyArray<string | undefined> {
  return [row.name, row.slug, row.description];
}

/**
 * A skill card's trailing ⋯ menu — the catalog-level shortcuts to the same
 * actions the detail panel offers, so the card aligns with the automations and
 * integrations catalogs. View details opens the panel; Duplicate reuses the
 * shared `useDuplicateSkill` mutation (then re-points the panel at the copy);
 * Delete opens the standalone `SkillDeleteDialog`. A broken bundle can't be
 * read, so it offers only View details + Delete (Duplicate would fail).
 */
function SkillCatalogMenu({
  organizationId,
  row,
  onViewDetails,
  onDuplicated,
}: {
  organizationId: string;
  row: SkillRow;
  onViewDetails: () => void;
  /** Re-point the detail panel at the freshly created copy. */
  onDuplicated: (newSlug: string) => void;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { mutateAsync: duplicateSkill } = useDuplicateSkill();
  const { mutateAsync: exportSkill } = useExportSkill();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newSlug } = await duplicateSkill({
        organizationId,
        slug: row.slug,
      });
      toast({
        title: t('skills.skillDuplicated', {
          defaultValue: 'Skill duplicated as {slug}',
          slug: newSlug,
        }),
        variant: 'success',
      });
      onDuplicated(newSlug);
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.skillDuplicateFailed', {
          defaultValue: 'Failed to duplicate skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [
    isDuplicating,
    duplicateSkill,
    organizationId,
    row.slug,
    onDuplicated,
    t,
  ]);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportSkill({ organizationId, slug: row.slug });
      downloadBase64File(result.filename, result.dataBase64, 'application/zip');
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.export.failed', {
          defaultValue: 'Failed to export skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, exportSkill, organizationId, row.slug, t]);

  return (
    <>
      <EntityRowActions
        ariaLabel={t('skills.actions.menuLabel', {
          defaultValue: 'Manage {name}',
          name: row.name,
        })}
        disabled={isDuplicating}
        actions={[
          {
            key: 'view',
            label: t('skills.actions.viewDetails', {
              defaultValue: 'View details',
            }),
            icon: Eye,
            onClick: onViewDetails,
          },
          {
            key: 'duplicate',
            label: t('skills.actions.duplicate', { defaultValue: 'Duplicate' }),
            icon: Copy,
            onClick: () => void handleDuplicate(),
            disabled: isDuplicating,
            // A broken bundle (unreadable SKILL.md) can't be copied.
            visible: !row.status,
          },
          {
            key: 'export',
            label: tCommon('actions.export'),
            icon: Download,
            onClick: () => void handleExport(),
            disabled: isExporting,
          },
          // EntityRowActions auto-inserts a divider before the destructive
          // Delete below.
          {
            key: 'delete',
            label: tCommon('actions.delete'),
            icon: Trash2,
            onClick: () => setDeleteOpen(true),
            destructive: true,
          },
        ]}
      />
      <SkillDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        organizationId={organizationId}
        skillSlug={row.slug}
        expectedHash={row.hash}
        onDeleted={() => setDeleteOpen(false)}
      />
    </>
  );
}

/**
 * The org Skills settings surface in the shared catalog style: one card per
 * skill bundle (broken bundles badge as read failures instead of vanishing),
 * the shared toolbar search, and a whole-card click into the full-management
 * `SkillDetailPanel` (Replace / Duplicate / Delete live there). Agent-side
 * skill BINDING keeps the checkbox table (`SkillsTable`), not this catalog.
 */
export function SkillsCatalog({
  organizationId,
  initialDetailSlug,
  action,
}: SkillsCatalogProps) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [search, setSearch] = useState('');
  const [detailSlug, setDetailSlug] = useState(initialDetailSlug ?? null);
  // Re-sync when the URL param changes (e.g. nav between two ?slug= URLs).
  useEffect(() => {
    if (initialDetailSlug != null) setDetailSlug(initialDetailSlug);
  }, [initialDetailSlug]);

  const {
    skills: rawSkills,
    isLoading,
    error,
    refetch,
  } = useListSkills(organizationId);
  const skills = useMemo(() => toSkillRows(rawSkills), [rawSkills]);
  const filtered = useCatalogSearch(skills, search, skillHaystack);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (error) {
    return (
      <ErrorDisplayCompact
        error={error}
        organizationId={organizationId}
        reset={handleRetry}
      />
    );
  }

  if (isLoading) {
    return (
      <Skeletonize loading label={t('skills.entityLabel')}>
        <Stack gap={4}>
          <CatalogToolbar
            search={{
              value: search,
              onChange: (e) => setSearch(e.target.value),
              placeholder: t('skills.searchPlaceholder', {
                defaultValue: 'Search skills…',
              }),
              disabled: true,
            }}
            action={action}
          />
          <CatalogGridSkeleton menu />
        </Stack>
      </Skeletonize>
    );
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title={tEmpty('skills.title', { defaultValue: 'No skills yet' })}
        description={tEmpty('skills.description', {
          defaultValue:
            'Skills are reusable instruction bundles you can attach to agents — like a playbook plus optional scripts.',
        })}
        action={action}
      />
    );
  }

  return (
    <Stack gap={4}>
      <CatalogToolbar
        search={{
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: t('skills.searchPlaceholder', {
            defaultValue: 'Search skills…',
          }),
        }}
        action={action}
      />
      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('skills.noResults.title')}
          description={t('skills.noResults.description')}
        />
      ) : (
        <CatalogGrid>
          {filtered.map((row) => (
            <CatalogCard
              key={row.slug}
              media={
                <CatalogCardIcon>
                  <SkillIcon
                    icon={row.icon}
                    className="text-muted-foreground size-5"
                  />
                </CatalogCardIcon>
              }
              title={row.name}
              // A broken row's description is its backend read-error message —
              // the badge already carries the localized "failed to read" state.
              description={row.status ? row.message : row.description}
              badge={
                row.status ? (
                  <Badge variant="destructive">
                    {t('skills.columns.loadError', {
                      defaultValue: 'Failed to read SKILL.md',
                    })}
                  </Badge>
                ) : undefined
              }
              meta={<CatalogLabels labels={row.labels} />}
              onClick={() => setDetailSlug(row.slug)}
              ariaLabel={row.name}
              menu={
                <SkillCatalogMenu
                  organizationId={organizationId}
                  row={row}
                  onViewDetails={() => setDetailSlug(row.slug)}
                  onDuplicated={setDetailSlug}
                />
              }
            />
          ))}
        </CatalogGrid>
      )}
      {detailSlug != null && (
        <SkillDetailPanel
          organizationId={organizationId}
          slug={detailSlug}
          onOpenChange={(open) => {
            if (!open) setDetailSlug(null);
          }}
          onSwitchSlug={setDetailSlug}
          readOnly={false}
        />
      )}
    </Stack>
  );
}
