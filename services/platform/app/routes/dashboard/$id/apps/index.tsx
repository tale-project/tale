import { createFileRoute } from '@tanstack/react-router';
import { Plus, Upload } from 'lucide-react';
import { useState } from 'react';

import { useCatalogSync } from '@/app/components/catalog/use-catalog-sync';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { AppUploadDialog } from '@/app/features/apps/components/app-upload/app-upload-dialog';
import { AppsGrid } from '@/app/features/apps/components/apps-grid';
import { useInvalidateApps } from '@/app/features/apps/hooks/use-apps';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/apps/')({
  component: AppsIndexPage,
});

function AppsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('apps');
  const ability = useAbility();
  const invalidateApps = useInvalidateApps();
  const [uploadOpen, setUploadOpen] = useState(false);
  // Uploading a private app (re)writes capability-bearing config on disk, so
  // gate the entry point on the same developer-settings capability the
  // `uploadAppBundle` action enforces server-side.
  const canUpload = ability.can('read', 'developerSettings');
  // "Update from catalog" lives inside the Add-app dropdown (same pattern as
  // the agents catalog), not as a standalone header button.
  const { menuItem: syncItem, dialog: syncDialog } = useCatalogSync({
    organizationId,
    domain: 'apps',
    onSynced: () => invalidateApps(organizationId),
  });

  return (
    <div className="p-4">
      <AppsGrid
        organizationId={organizationId}
        action={
          canUpload ? (
            <DataTableActionMenu
              label={t('addMenu.label')}
              icon={Plus}
              menuItems={[
                {
                  label: t('upload.uploadApp'),
                  icon: Upload,
                  onClick: () => setUploadOpen(true),
                },
                ...(syncItem ? [syncItem] : []),
              ]}
            />
          ) : undefined
        }
      />
      {canUpload ? (
        <AppUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          organizationId={organizationId}
        />
      ) : null}
      {syncDialog}
    </div>
  );
}
