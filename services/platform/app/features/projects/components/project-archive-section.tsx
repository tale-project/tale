'use client';

import { Button } from '@tale/ui/button';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { ProjectArchiveDialog } from './project-archive-dialog';

interface ProjectArchiveSectionProps {
  projectId: Id<'projects'>;
  projectName: string;
  isArchived: boolean;
}

export function ProjectArchiveSection({
  projectId,
  projectName,
  isArchived,
}: ProjectArchiveSectionProps) {
  const { t } = useT('projects');
  const [open, setOpen] = useState(false);

  return (
    <SettingsSection
      title={t('dangerZone.archiveSectionTitle')}
      description={t(
        isArchived ? 'dangerZone.restoreHelp' : 'dangerZone.archiveHelp',
      )}
      action={
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {isArchived ? t('rowActions.restore') : t('rowActions.archive')}
        </Button>
      }
    >
      {open && (
        <ProjectArchiveDialog
          open={open}
          onOpenChange={setOpen}
          projectId={projectId}
          isArchived={isArchived}
          projectName={projectName}
        />
      )}
    </SettingsSection>
  );
}
