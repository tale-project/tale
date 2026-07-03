import { Button } from '@tale/ui/button';
import { createFileRoute } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import { useState } from 'react';

import { AppUploadDialog } from '@/app/features/apps/components/app-upload/app-upload-dialog';
import { AppsGrid } from '@/app/features/apps/components/apps-grid';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/apps/')({
  component: AppsIndexPage,
});

function AppsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('apps');
  const ability = useAbility();
  const [uploadOpen, setUploadOpen] = useState(false);
  // Uploading a private app (re)writes capability-bearing config on disk, so
  // gate the entry point on the same developer-settings capability the
  // `uploadAppBundle` action enforces server-side.
  const canUpload = ability.can('read', 'developerSettings');

  return (
    <div className="p-4">
      <AppsGrid
        organizationId={organizationId}
        action={
          canUpload ? (
            <Button variant="secondary" onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" />
              {t('upload.uploadApp', { defaultValue: 'Upload app' })}
            </Button>
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
    </div>
  );
}
