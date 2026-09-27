// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { TaskSubjectContract } from '@tale/shared/schemas/task-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

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

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: mocks.documents }),
}));

// One stand-in for every write the card makes: the upload-URL mint and the
// document create.
const backendMutation = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: backendMutation }),
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', () => ({ toast: toastMock }));

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
      projectId={'project_1' as string}
      folderId={FOLDER as string}
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

  it('deletes a file only while removal is allowed, behind an honest confirm', async () => {
    mocks.documents = [doc('sales.csv', 1)];
    const { user } = renderCard(true, true);

    // The verb is Delete, not Remove — the action permanently deletes the
    // project document, and the dialog says so before anything happens.
    await user.click(screen.getByRole('button', { name: 'Delete sales.csv' }));
    expect(
      screen.getByText(/deletes "sales\.csv" from the project permanently/),
    ).toBeInTheDocument();
    // Nothing is deleted until the destructive dialog confirms it.
    expect(deleteDocument).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteDocument).toHaveBeenCalledWith({
      documentId: 'doc_sales.csv',
    });
  });

  it('offers no removal once the task reached review', () => {
    // The modal turns canRemove off from In review on — the folder is the
    // delivered evidence base and must not shrink under a reviewer.
    mocks.documents = [doc('sales.csv', 1)];
    renderCard(true, false);

    expect(
      screen.queryByRole('button', { name: 'Delete sales.csv' }),
    ).toBeNull();
  });

  it('offers no drop target to a reader who cannot edit', () => {
    mocks.documents = [doc('sales.csv', 1)];
    renderCard(false);

    expect(screen.queryByRole('group', { name: 'Files' })).toBeNull();
    expect(screen.getByText('sales.csv')).toBeInTheDocument();
  });
});

/**
 * A refused upload used to throw `upload failed: 400`, and the toast said
 * "try again" with nothing the door had said. It now names each file that
 * did not land beside the door's reason, and a refused file no longer keeps
 * the rest of the pick from landing.
 */
describe('TaskInputFilesCard upload refusals', () => {
  beforeEach(() => {
    mocks.documents = [];
    toastMock.mockReset();
    backendMutation.mockReset();
    // The upload-URL mint answers a URL; the document create a row id.
    backendMutation.mockImplementation((args: unknown) =>
      Promise.resolve(
        args !== null && typeof args === 'object' && 'fileId' in args
          ? 'doc_new'
          : '/api/app/files/upload?orgId=org_1',
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function dropZoneInput(): HTMLInputElement {
    const input = document.getElementById('task-input-files-upload');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('drop-zone input missing');
    }
    return input;
  }

  const pdf = (name: string) =>
    new File(['%PDF-1.7'], name, { type: 'application/pdf' });

  /** The files door's answer to a body past its ceiling. */
  const tooLarge = () =>
    Response.json(
      {
        error: 'FILE_SIZE_INVALID',
        message: 'The file exceeds the 512 MiB limit',
      },
      { status: 413 },
    );

  it("names the refused file beside the door's reason", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tooLarge());
    const { user } = renderCard();

    await user.upload(dropZoneInput(), pdf('invoice.pdf'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Couldn't finish the upload — try again.",
        description: 'invoice.pdf: The file exceeds the 512 MiB limit',
        variant: 'destructive',
      });
    });
    // Only the URL mint ran: nothing was filed for a refused upload.
    expect(backendMutation).toHaveBeenCalledTimes(1);
  });

  it('names the bare code when the door sends no sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'RATE_LIMITED', code: 'RATE_LIMITED' },
        { status: 429 },
      ),
    );
    const { user } = renderCard();

    await user.upload(dropZoneInput(), pdf('invoice.pdf'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'invoice.pdf: RATE_LIMITED' }),
      );
    });
  });

  it('names only the file for a failure the door did not answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    const { user } = renderCard();

    await user.upload(dropZoneInput(), pdf('invoice.pdf'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Couldn't finish the upload — try again.",
        description: 'invoice.pdf',
        variant: 'destructive',
      });
    });
  });

  it('files the rest of the pick past a refused file, and says which one it was', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tooLarge())
      .mockResolvedValueOnce(Response.json({ storageId: 'blob_b' }));
    const { user } = renderCard();

    await user.upload(dropZoneInput(), [pdf('a.pdf'), pdf('b.pdf')]);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledTimes(1);
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'a.pdf: The file exceeds the 512 MiB limit',
      }),
    );
    expect(backendMutation).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'blob_b', fileName: 'b.pdf' }),
    );
  });
});
