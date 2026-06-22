'use client';

/**
 * Install flow for a `scope: 'project'` app: pick the target project (or create
 * one inline), install into it, then route into the app under that project. Org-
 * scoped apps never reach this — they install in one click from the hub/app page.
 */
import { Button } from '@tale/ui/button';
import { VStack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { useAppInstallActions } from '../hooks/use-install-state';

export function AppInstallDialog({
  open,
  onOpenChange,
  organizationId,
  appSlug,
  appName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  appSlug: string;
  appName: string;
}) {
  const { t } = useT('apps');
  const navigate = useNavigate();
  const { projects } = useProjects(organizationId);
  const { install, isPending } = useAppInstallActions(organizationId);
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const installInto = async (projectId: string) => {
    await install(appSlug, projectId);
    setSelected(null);
    onOpenChange(false);
    void navigate({
      to: '/dashboard/$id/projects/$projectId/apps/$appSlug',
      params: { id: organizationId, projectId, appSlug },
    });
  };

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('install.chooseProjectTitle', { name: appName })}
        description={t('install.chooseProjectDescription')}
        submitText={t('install.install')}
        submittingText={t('install.install')}
        isSubmitting={isPending}
        isValid={selected !== null}
        onSubmit={(e) => {
          e.preventDefault();
          if (selected) void installInto(selected);
        }}
      >
        <VStack gap={3}>
          <SearchableSelect
            label={t('install.projectLabel')}
            placeholder={t('install.projectPlaceholder')}
            searchPlaceholder={t('install.projectSearchPlaceholder')}
            emptyText={t('install.noProjects')}
            value={selected}
            onValueChange={setSelected}
            options={projects.map((p) => ({ value: p._id, label: p.name }))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Plus}
            className="self-start"
            onClick={() => setCreateOpen(true)}
          >
            {t('install.createProject')}
          </Button>
        </VStack>
      </FormDialog>
      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        navigateOnCreate={false}
        onCreated={(projectId) => void installInto(String(projectId))}
      />
    </>
  );
}
