import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectFilesTab } from './project-files-tab';

// Regression coverage for issue #2070: the Files tab exposed no way to
// download/open/preview an attached file. The fix wires the existing
// DocumentPreviewDialog into each row (a clickable title + an explicit preview
// IconButton) whenever the row carries a storage `fileId`. The preview dialog
// itself self-fetches via Convex, so it's stubbed here to a deterministic
// surface; what's asserted at the component tier is the same observable
// behaviour a user drives: a previewable row exposes the affordance and
// activating it opens the dialog for the right document, while a row without a
// stored file shows no affordance.

type DocFixture = {
  _id: Id<'documents'>;
  _creationTime: number;
  title?: string;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  indexed?: boolean;
  ragStatus: 'queued' | 'running' | 'completed' | 'failed' | null;
  createdBy?: string;
};

let documentsFixture: DocFixture[] = [];
let projectFixture: { canEdit: boolean } | null = { canEdit: true };

vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: projectFixture, isLoading: false }),
  useProjectDocuments: () => ({
    documents: documentsFixture,
    isLoading: false,
  }),
}));

const detachMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../hooks/mutations', () => ({
  useDetachDocumentFromProject: () => ({
    mutateAsync: detachMutateAsync,
  }),
}));

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

// The real preview dialog self-fetches the document/URL through Convex; stub it
// to a deterministic surface that records the document it was asked to open.
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: ({
    open,
    documentId,
    fileName,
  }: {
    open: boolean;
    documentId?: string;
    fileName?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label="Preview">
        <span data-testid="preview-doc-id">{documentId}</span>
        <span data-testid="preview-file-name">{fileName}</span>
      </div>
    ) : null,
}));

const PROJECT_ID = 'proj-1' as Id<'projects'>;

function renderTab() {
  return render(
    <ProjectFilesTab organizationId="org-1" projectId={PROJECT_ID} />,
  );
}

function makeDoc(overrides: Partial<DocFixture> = {}): DocFixture {
  return {
    _id: 'doc-1' as Id<'documents'>,
    _creationTime: 0,
    title: 'Report.pdf',
    fileId: 'storage-1' as Id<'_storage'>,
    mimeType: 'application/pdf',
    ragStatus: 'completed',
    ...overrides,
  };
}

describe('ProjectFilesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documentsFixture = [];
    projectFixture = { canEdit: true };
  });

  it('exposes a preview affordance on a row that has a stored file', () => {
    documentsFixture = [makeDoc()];
    renderTab();

    // The title is a button (opens the preview) and there's an explicit
    // "Preview file" control.
    expect(
      screen.getByRole('button', { name: 'Report.pdf' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Preview file' }),
    ).toBeInTheDocument();
  });

  it('opens the preview dialog for the row when the preview button is clicked', async () => {
    documentsFixture = [makeDoc()];
    const { user } = renderTab();

    expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Preview file' }));

    const dialog = await screen.findByRole('dialog', { name: 'Preview' });
    expect(within(dialog).getByTestId('preview-doc-id')).toHaveTextContent(
      'doc-1',
    );
    expect(within(dialog).getByTestId('preview-file-name')).toHaveTextContent(
      'Report.pdf',
    );
  });

  it('opens the preview when the file title is clicked', async () => {
    documentsFixture = [makeDoc()];
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: 'Report.pdf' }));

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Preview' }),
      ).toBeInTheDocument();
    });
  });

  it('shows no preview affordance for a row without a stored file', async () => {
    documentsFixture = [makeDoc({ fileId: undefined, title: 'Pending.pdf' })];
    renderTab();

    // The title renders as plain text, not a button, and no preview control.
    expect(screen.getByText('Pending.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pending.pdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview file' })).toBeNull();
  });

  // Regression coverage for issue #2546 — "Remove from project" silently
  // published the file to the org-wide Knowledge Hub. The confirmation must
  // name that consequence and the mutation must carry the explicit
  // destination.
  it('names the org-wide consequence in the detach confirmation and detaches with an explicit destination', async () => {
    documentsFixture = [makeDoc()];
    const { user } = renderTab();

    await user.click(
      screen.getByRole('button', { name: 'Remove from project' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Remove from project',
    });
    expect(
      within(dialog).getByText(/visible to everyone in the organization/i),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: 'Remove from project' }),
    );

    await waitFor(() => {
      expect(detachMutateAsync).toHaveBeenCalledWith({
        documentId: 'doc-1',
        destination: 'organization',
      });
    });
  });
});
