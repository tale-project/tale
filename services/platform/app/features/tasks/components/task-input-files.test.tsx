// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';
import { render, screen } from '@/tests/utils/render';

// The FILES zone is always open and previews a FEW names: a folder holding a
// quarter's documents plus one derived artifact per document must not push the
// deliverables below the fold, and the few it shows have to be the ones a reader
// asks about (their own uploads), not the run's `.ocr.json` sidecars.

const mocks = vi.hoisted(() => ({
  documents: [] as Array<{
    _id: string;
    title: string;
    folderId?: string;
    sourceProvider?: string;
    _creationTime: number;
  }>,
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: mocks.documents }),
}));

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

const deleteDocument = vi.hoisted(() => vi.fn());
vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useDeleteDocument: () => ({ mutateAsync: deleteDocument }),
}));

import { TaskInputFilesCard } from './task-input-files';

const FOLDER = 'folder_2026q1';

const contract: TaskSubjectContract = {
  workflow: 'document-verify-desk',
  input: { kind: 'folder' },
  outcome: { files: ['return.xml'] },
};

/** An uploaded document (no run stamp) or a run artifact. */
function doc(
  title: string,
  at: number,
  producedByRun = false,
): (typeof mocks.documents)[number] {
  return {
    _id: `doc_${title}`,
    title,
    folderId: FOLDER,
    _creationTime: at,
    ...(producedByRun ? { sourceProvider: 'agent' } : {}),
  };
}

function renderCard(canEdit = true, canRemove = false) {
  return render(
    <TaskInputFilesCard
      organizationId="org_1"
      projectId={'project_1' as Id<'projects'>}
      folderId={FOLDER as Id<'folders'>}
      contract={contract}
      automationName="Document verification desk"
      canEdit={canEdit}
      canRemove={canRemove}
    />,
  );
}

const listedNames = () =>
  screen
    // `queryAll`, not `getAll`: an empty folder renders no button at all.
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('Open '))
    .map((label) => label.replace('Open ', ''));

describe('TaskInputFilesCard', () => {
  beforeEach(() => {
    mocks.documents = [];
  });

  it('is open from the first look, with the count and the drop target', () => {
    mocks.documents = [doc('sales.csv', 1)];
    renderCard();

    expect(
      screen.getByRole('heading', { name: 'Files (1)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('sales.csv')).toBeInTheDocument();
    // No disclosure to open first — the zone never hides its own subject.
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  });

  it('names the automation while the folder is empty', () => {
    renderCard();

    expect(
      screen.getByText(
        'No files yet — drop the documents Document verification desk should work from.',
      ),
    ).toBeInTheDocument();
    expect(listedNames()).toEqual([]);
  });

  it('previews the uploads before the run material, newest first', () => {
    mocks.documents = [
      doc('scan-a.ocr.json', 10, true),
      doc('invoice-old.pdf', 1),
      doc('scan-b.ocr.json', 11, true),
      doc('invoice-new.pdf', 2),
    ];
    renderCard();

    expect(listedNames()).toEqual([
      'invoice-new.pdf',
      'invoice-old.pdf',
      'scan-b.ocr.json',
      'scan-a.ocr.json',
    ]);
  });

  it('lists a few and reveals the tail on the toggle', async () => {
    mocks.documents = Array.from({ length: 8 }, (_, index) =>
      doc(`upload-${index}.pdf`, 8 - index),
    );
    const { user } = renderCard();

    expect(listedNames()).toHaveLength(5);
    const more = screen.getByRole('button', { name: '+3 more' });
    // The toggle acts on the whole list, so it sits after every name.
    expect(
      more.compareDocumentPosition(screen.getByText('upload-4.pdf')) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    await user.click(more);
    expect(listedNames()).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(listedNames()).toHaveLength(5);
  });

  it('removes a file only while removal is allowed, behind a confirm', async () => {
    mocks.documents = [doc('sales.csv', 1)];
    const { user } = renderCard(true, true);

    await user.click(screen.getByRole('button', { name: 'Remove sales.csv' }));
    // Nothing is deleted until the destructive dialog confirms it.
    expect(deleteDocument).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(deleteDocument).toHaveBeenCalledWith({
      documentId: 'doc_sales.csv',
    });
  });

  it('offers no removal once the task reached review', () => {
    // The modal turns canRemove off from In review on — the folder is the
    // delivered return's evidence base and must not shrink under a reviewer.
    mocks.documents = [doc('sales.csv', 1)];
    renderCard(true, false);

    expect(
      screen.queryByRole('button', { name: 'Remove sales.csv' }),
    ).toBeNull();
  });

  it('offers no drop target to a reader who cannot edit', () => {
    mocks.documents = [doc('sales.csv', 1)];
    renderCard(false);

    expect(screen.queryByRole('group', { name: 'Files' })).toBeNull();
    expect(screen.getByText('sales.csv')).toBeInTheDocument();
  });
});
