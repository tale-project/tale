'use client';

/**
 * The project's danger zone — delete only (dialog-guarded, cascading) — at
 * the bottom of the project's general page, in the same destructive-Alert
 * vocabulary as the organization settings. The chat sidebar's folder menu
 * deep-links here via PROJECT_DANGER_ZONE_ID.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { ProjectDeleteDialog } from './project-delete-dialog';

/** The section's DOM id — the chat sidebar's folder menu navigates to it. */
export const PROJECT_DANGER_ZONE_ID = 'project-danger';

export function ProjectDangerZone({
  organizationId,
  projectId,
  projectName,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  projectName: string;
}) {
  const { t } = useT('projects');
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <SettingsSection
      id={PROJECT_DANGER_ZONE_ID}
      title={t('dangerZone.title')}
      description={t('dangerZone.description')}
    >
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

      {/* Mounted only while open — the mutation hook needs the app's data
          providers, and a closed dialog must cost the page nothing. */}
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
