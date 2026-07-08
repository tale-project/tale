import { Stack } from '@tale/ui/layout';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { useCatalogSync } from '@/app/components/catalog/use-catalog-sync';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { AutomationUploadDialog } from '@/app/features/automations/components/automation-upload/automation-upload-dialog';
import { AutomationsGrid } from '@/app/features/automations/components/automations-grid';
import { DEFAULT_AUTOMATIONS_TAB } from '@/app/features/automations/components/automations-navigation';
import { useInvalidateAutomations } from '@/app/features/automations/hooks/use-automations';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/automations/')({
  component: AutomationsIndexPage,
  validateSearch: z.object({
    slug: z.string().optional(),
    // The Installed/All filter. It lives in the URL (not component state) so the
    // layout's header tab strip — the shared `TabNavigation`, like Knowledge's —
    // can drive it and deep links keep working.
    tab: z.enum(['installed', 'all']).optional(),
  }),
});

/**
 * The automations layout owns the page <h1> AND the Installed/All tab strip; the
 * content opens straight with the catalog (search + the Add menu in the toolbar
 * row — no second title block, no second tab strip).
 */
function AutomationsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { slug: initialSlug, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t } = useT('automations');
  const ability = useAbility();
  const invalidateAutomations = useInvalidateAutomations();
  const [uploadOpen, setUploadOpen] = useState(false);
  // Uploading a private automation (re)writes capability-bearing config on
  // disk, so
  // gate the entry point on the same developer-settings capability the
  // `uploadAutomationBundle` action enforces server-side.
  const canUpload = ability.can('read', 'developerSettings');
  // "Update from catalog" lives inside the Add-automation dropdown (same
  // pattern as the agents catalog), not as a standalone header button.
  const { menuItem: syncItem, dialog: syncDialog } = useCatalogSync({
    organizationId,
    domain: 'automations',
    onSynced: () => invalidateAutomations(organizationId),
  });

  return (
    <Stack gap={6} className="p-4">
      <AutomationsGrid
        organizationId={organizationId}
        tab={tab ?? DEFAULT_AUTOMATIONS_TAB}
        initialSlug={initialSlug}
        onInitialSlugConsumed={() =>
          // Preserve `?tab=` — clearing the whole search would bounce the
          // header tab strip back to Installed.
          navigate({
            search: (prev) => ({ ...prev, slug: undefined }),
            replace: true,
          })
        }
        toolbarAction={
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
        <AutomationUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          organizationId={organizationId}
        />
      ) : null}
      {syncDialog}
    </Stack>
  );
}
