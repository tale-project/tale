'use client';

/**
 * The project's danger zone — archive (reversible shelf) and delete
 * (dialog-guarded, cascading) — at the bottom of the project's general page,
 * in the same destructive-Alert vocabulary as the organization settings. The
 * chat sidebar's folder menu deep-links here, so both destructive actions
 * have ONE home with their consequences spelled out.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { ProjectArchiveDialog } from './project-archive-dialog';
import { ProjectDeleteDialog } from './project-delete-dialog';

/** The section's DOM id — the chat sidebar's folder menu navigates to it. */
export const PROJECT_DANGER_ZONE_ID = 'project-danger';

export function ProjectDangerZone({
  organizationId,
  projectId,
  projectName,
  isArchived,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  projectName: string;
  isArchived: boolean;
}) {
  const { t } = useT('projects');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <SettingsSection
      id={PROJECT_DANGER_ZONE_ID}
      title={t('dangerZone.title')}
      description={t('dangerZone.description')}
    >
      <Alert
        variant="warning"
        live="off"
        icon={AlertTriangle}
        title={isArchived ? t('rowActions.restore') : t('rowActions.archive')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">
            {t(
              isArchived ? 'dangerZone.restoreHelp' : 'dangerZone.archiveHelp',
            )}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => setArchiveOpen(true)}
          >
            {isArchived ? t('rowActions.restore') : t('rowActions.archive')}
          </Button>
        </div>
      </Alert>

      <Alert
        variant="destructive"
        live="off"
        icon={AlertTriangle}
        title={t('rowActions.delete')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">{t('dangerZone.deleteHelp')}</span>
          <Button
            type="button"
            variant="destructive"
            className="shrink-0"
            onClick={() => setDeleteOpen(true)}
          >
            {t('rowActions.delete')}
          </Button>
        </div>
      </Alert>

      {/* Mounted only while open — their mutation hooks need the app's data
          providers, and a closed dialog must cost the page nothing. */}
      {archiveOpen && (
        <ProjectArchiveDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          projectId={projectId}
          isArchived={isArchived}
          projectName={projectName}
        />
      )}
      {deleteOpen && (
        <ProjectDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          organizationId={organizationId}
          projectId={projectId}
          projectName={projectName}
        />
      )}
    </SettingsSection>
  );
}
