import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProjectFilesSkeleton } from '@/app/features/projects/components/project-tab-skeletons';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const searchSchema = z.object({
  folderId: z.string().optional(),
  /**
   * Deep-link from automation navigate / shareable URL — open the create-
   * folder dialog once (`?createFolder=1` or `true`).
   */
  createFolder: z
    .union([z.string(), z.boolean(), z.number()])
    .optional()
    .transform((v) =>
      v === true || v === 1 || v === '1' || v === 'true' ? true : undefined,
    ),
  /**
   * Deep-link to open version history for a document keyed by
   * `externalItemId` (e.g. Levy `acme:{projectId}:transform.py`).
   */
  historyExternalItemId: z.string().optional(),
  /**
   * Deep-link to open a document's preview by id — the project twin of the
   * knowledge library's `?doc=` (review notifications land here).
   */
  doc: z.string().optional(),
});

// Skeletonized layout frame shown while the tab's JS chunk loads — the real
// tab (with its own data-loading mask) takes over once the chunk resolves.

// §8: lazy-load tab content. Overview stays eager (default landing); the
// other tabs are bundled on first navigation only.
const ProjectFilesTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-files-tab').then(
      (mod) => ({ default: mod.ProjectFilesTab }),
    ),
  { loading: () => <ProjectFilesSkeleton /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/files',
)({
  validateSearch: searchSchema,
  // Warm the tab chunk during the loader so it's cached by render time —
  // removes the Suspense fallback flash on first nav (tab links preload on
  // render, so this typically fires before the click). Fire-and-forget.
  loader: () => {
    void import('@/app/features/projects/components/project-files-tab');
  },
  component: ProjectFilesPage,
});

function ProjectFilesPage() {
  const { id: organizationId, projectId } = Route.useParams();
  const { folderId, createFolder, historyExternalItemId, doc } =
    Route.useSearch();
  return (
    <ProjectFilesTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
      initialFolderId={folderId}
      openCreateFolder={createFolder === true}
      historyExternalItemId={historyExternalItemId}
      previewDocumentId={doc}
    />
  );
}
