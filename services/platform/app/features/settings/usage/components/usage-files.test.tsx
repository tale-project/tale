import { toast } from '@tale/ui/use-toast';
import type { ReactNode, RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import { toBackendError } from '@/app/lib/backend/adapters';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { UploadUsageFile } from '../hooks/queries';
import { UsageFiles } from './usage-files';

/** What the preview was asked to show, as the row hands it over. */
interface PreviewProps {
  open: boolean;
  fileId?: string;
  fileName?: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** What a row asks the legal-hold read about. */
interface HoldTarget {
  organizationId: string | undefined;
  targetType: string;
  targetId: string | undefined;
}

const state = vi.hoisted(() => ({
  files: [] as UploadUsageFile[],
  error: null as Error | null,
  retry: vi.fn<() => void>(),
  loadMore: vi.fn<(numItems: number) => void>(),
  readFor: undefined as string | undefined,
  canWrite: true,
  deleteDocument: vi.fn<(args: { documentId: string }) => Promise<unknown>>(),
  preview: vi.fn<(props: PreviewProps) => void>(),
  legalHoldByTarget: vi.fn<(target: HoldTarget) => { data: unknown }>(),
}));

vi.mock('../hooks/queries', () => ({
  useUploadUsageFiles: (
    organizationId: string,
  ): UsePaginatedQueryReturnType<UploadUsageFile> => {
    state.readFor = organizationId;
    return {
      results: state.files,
      status: 'Exhausted',
      isLoading: false,
      loadMore: state.loadMore,
      error: state.error,
      retry: state.retry,
      isRetrying: false,
      unavailable: false,
      loadMoreFailed: false,
      errorCount: state.error === null ? 0 : 1,
    };
  },
}));

vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useDeleteDocument: () => ({
    mutateAsync: state.deleteDocument,
    isPending: false,
  }),
}));

// The real preview loads the viewers and fetches the file; this one records
// what the row asked it to open. It loads under the real lazy wrapper, whose
// "Document preview" region is what a mounted preview adds to the page.
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: (props: PreviewProps) => {
    state.preview(props);
    return props.open ? (
      <div role="dialog" aria-label="Preview">
        {props.fileName}
      </div>
    ) : null;
  },
}));

// Whether a legal hold covers a document is the backend's answer; each test
// says it here.
vi.mock(
  '@/app/features/settings/governance/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/governance/hooks/queries')
    >()),
    useLegalHoldByTarget: (target: HoldTarget) =>
      state.legalHoldByTarget(target),
  }),
);

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

// Delete is offered to a role that writes documents.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => {
    const can = (action: string, subject: string) =>
      state.canWrite && action === 'write' && subject === 'knowledgeWrite';
    return {
      can,
      cannot: (action: string, subject: string) => !can(action, subject),
    };
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
    search,
    className,
    title,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    className?: string;
    title?: string;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (href, [key, value]) => href.replace(`$${key}`, value),
      to,
    );
    const query = new URLSearchParams(search).toString();
    return (
      <a
        href={query === '' ? path : `${path}?${query}`}
        className={className}
        title={title}
      >
        {children}
      </a>
    );
  },
}));

const KB = 1024;
const MB = 1024 ** 2;

type StoredDocument = NonNullable<UploadUsageFile['document']>;

/** The document a row's file backs: uploaded by hand, the file its current
 * one, not a protected record, unless told otherwise. */
function storedDocument(
  id: string,
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id,
    title: null,
    sourceProvider: 'upload',
    sourceMode: 'manual',
    current: true,
    recordProtected: false,
    ...overrides,
  };
}

/** One row of the listing: an uploaded Knowledge document unless told
 * otherwise, its ids derived from `key`. */
function storedFile(
  key: string,
  overrides: Partial<UploadUsageFile> = {},
): UploadUsageFile {
  return {
    id: `upload-${key}`,
    storageRef: `storage-${key}`,
    name: `${key}.pdf`,
    contentType: 'application/pdf',
    size: MB,
    createdAt: Date.UTC(2026, 9, 1),
    kind: 'documents',
    document: storedDocument(`doc-${key}`),
    place: { type: 'knowledge', open: true },
    inTrash: false,
    ...overrides,
  };
}

type User = ReturnType<typeof render>['user'];

/** The table row of the file named `name` (its name cell carries it as a
 * title). */
function fileRow(name: string): HTMLElement {
  const row = screen.getByTitle(name).closest('tr');
  if (row === null) throw new Error(`No row lists ${name}`);
  return row;
}

/** The Location cell of the file named `name`. */
function placeOf(name: string): HTMLElement {
  const [, , place] = within(fileRow(name)).getAllByRole('cell');
  if (place === undefined) throw new Error(`No Location cell for ${name}`);
  return place;
}

/** The entries of the row menu of the file named `name`. */
async function menuEntries(user: User, name: string) {
  await user.click(
    within(fileRow(name)).getByRole('button', { name: 'Open menu' }),
  );
  const menu = await screen.findByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);
}

/** Opens the delete confirmation of the file named `name`. */
async function askToDelete(user: User, name: string) {
  await user.click(
    within(fileRow(name)).getByRole('button', { name: 'Open menu' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  return screen.findByRole('dialog', { name: 'Delete document' });
}

describe('UsageFiles', () => {
  beforeEach(() => {
    state.files = [];
    state.error = null;
    state.retry.mockReset();
    state.loadMore.mockReset();
    state.readFor = undefined;
    state.canWrite = true;
    state.deleteDocument.mockReset().mockResolvedValue(undefined);
    state.preview.mockReset();
    state.legalHoldByTarget.mockReset().mockReturnValue({ data: null });
    vi.mocked(toast).mockClear();
  });

  it('lists the files in the order the server pages them, each with its kind and size', () => {
    state.files = [
      storedFile('deck', { size: 2.5 * MB }),
      storedFile('photo', {
        name: 'photo.jpg',
        size: 1.5 * MB,
        kind: 'chatAttachments',
        document: null,
        place: { type: 'chat', id: 'thread-1', title: 'Budget', open: true },
      }),
      storedFile('reading', {
        name: 'reading.json',
        size: 512 * KB,
        kind: 'agentFiles',
        document: storedDocument('doc-reading', { sourceProvider: 'agent' }),
      }),
      storedFile('export', {
        name: 'export.zip',
        size: 1.5 * KB,
        kind: 'other',
        document: null,
        place: { type: 'none', open: false },
      }),
    ];

    render(<UsageFiles organizationId="org-1" />);

    expect(state.readFor).toBe('org-1');
    const table = screen.getByRole('table', {
      name: 'Files that count toward your storage limit',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .slice(0, 5)
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Kind', 'Location', 'Size', 'Uploaded']);
    const rows = within(table)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(0, 4)
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['deck.pdf', 'Document', 'Knowledge', '2.5 MB'],
      ['photo.jpg', 'Chat attachment', 'Budget', '1.5 MB'],
      ['reading.json', 'Made by an agent', 'Knowledge', '512 KB'],
      [
        'export.zip',
        'Other file',
        'Not in Knowledge, a project or a chat',
        '1.5 KB',
      ],
    ]);
    expect(screen.getByRole('link', { name: 'Back to Usage' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/usage',
    );
  });

  it('links each place the person may open, and names the ones they cannot', () => {
    state.files = [
      storedFile('library'),
      storedFile('restricted', { place: { type: 'knowledge', open: false } }),
      storedFile('archived', {
        place: {
          type: 'project',
          id: 'proj-1',
          name: 'Riverside',
          archived: true,
          open: true,
        },
      }),
      storedFile('vendor', {
        place: {
          type: 'project',
          id: 'proj-2',
          name: 'Vendor audit',
          archived: false,
          open: false,
        },
      }),
      storedFile('hidden-project', {
        place: {
          type: 'project',
          id: null,
          name: null,
          archived: false,
          open: false,
        },
      }),
      storedFile('own-chat', {
        kind: 'chatAttachments',
        document: null,
        place: {
          type: 'chat',
          id: 'thread-1',
          title: 'Budget questions',
          open: true,
        },
      }),
      storedFile('untitled-chat', {
        kind: 'chatAttachments',
        document: null,
        place: { type: 'chat', id: 'thread-2', title: null, open: true },
      }),
      storedFile('shared-chat', {
        kind: 'chatAttachments',
        document: null,
        place: {
          type: 'chat',
          id: 'thread-3',
          title: 'Team review',
          open: false,
        },
      }),
      storedFile('hidden-chat', {
        kind: 'chatAttachments',
        document: null,
        place: { type: 'chat', id: null, title: null, open: false },
      }),
      storedFile('loose', {
        kind: 'other',
        document: null,
        place: { type: 'none', open: false },
      }),
    ];

    render(<UsageFiles organizationId="org-1" />);

    // A library document opens in Knowledge, on the document itself.
    expect(
      within(placeOf('library.pdf')).getByRole('link', { name: 'Knowledge' }),
    ).toHaveAttribute('href', '/dashboard/org-1/documents?doc=doc-library');
    expect(placeOf('restricted.pdf')).toHaveTextContent('Knowledge');
    expect(within(placeOf('restricted.pdf')).queryByRole('link')).toBeNull();

    // A project's opens in its Files tab, an archived one marked so.
    const archived = placeOf('archived.pdf');
    expect(
      within(archived).getByRole('link', { name: 'Riverside' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/files?doc=doc-archived',
    );
    expect(within(archived).getByText('Archived')).toBeInTheDocument();
    const vendor = placeOf('vendor.pdf');
    expect(vendor).toHaveTextContent('Vendor audit');
    expect(within(vendor).queryByRole('link')).toBeNull();
    expect(within(vendor).queryByText('Archived')).toBeNull();
    expect(placeOf('hidden-project.pdf')).toHaveTextContent(
      "A project you can't open",
    );
    expect(
      within(placeOf('hidden-project.pdf')).queryByRole('link'),
    ).toBeNull();

    // A chat file opens in the chat; one the person can't open is named only.
    expect(
      within(placeOf('own-chat.pdf')).getByRole('link', {
        name: 'Budget questions',
      }),
    ).toHaveAttribute('href', '/dashboard/org-1/chat/thread-1');
    expect(
      within(placeOf('untitled-chat.pdf')).getByRole('link', {
        name: 'Untitled chat',
      }),
    ).toHaveAttribute('href', '/dashboard/org-1/chat/thread-2');
    const shared = placeOf('shared-chat.pdf');
    expect(shared).toHaveTextContent('Team review');
    expect(within(shared).queryByRole('link')).toBeNull();
    expect(placeOf('hidden-chat.pdf')).toHaveTextContent(
      "A chat you can't open",
    );
    expect(within(placeOf('hidden-chat.pdf')).queryByRole('link')).toBeNull();
    expect(placeOf('loose.pdf')).toHaveTextContent(
      'Not in Knowledge, a project or a chat',
    );
  });

  it('marks a file in Trash and offers it no actions', () => {
    state.files = [storedFile('kept'), storedFile('binned', { inTrash: true })];

    render(<UsageFiles organizationId="org-1" />);

    const binned = fileRow('binned.pdf');
    expect(within(binned).getByText('In Trash')).toBeInTheDocument();
    expect(
      within(binned).queryByRole('button', { name: 'Open menu' }),
    ).toBeNull();
    const kept = fileRow('kept.pdf');
    expect(within(kept).queryByText('In Trash')).toBeNull();
    expect(
      within(kept).getByRole('button', { name: 'Open menu' }),
    ).toBeInTheDocument();
  });

  it.each<[string, Partial<UploadUsageFile>]>([
    ['an uploaded document in Knowledge', {}],
    [
      // Knowledge offers Delete on what no sync brings back, whichever
      // door the document came in by.
      'a document saved into Knowledge over WebDAV',
      {
        document: storedDocument('doc-file', {
          sourceProvider: 'webdav',
          sourceMode: 'manual',
        }),
      },
    ],
    [
      'a document an agent wrote into an open project',
      {
        document: storedDocument('doc-file', { sourceProvider: 'agent' }),
        place: {
          type: 'project',
          id: 'proj-1',
          name: 'Riverside',
          archived: false,
          open: true,
        },
      },
    ],
  ])('offers Delete for %s', async (_case, overrides) => {
    state.files = [storedFile('file', overrides)];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(await menuEntries(user, 'file.pdf')).toEqual(['Open', 'Delete']);
  });

  it.each<[string, Partial<UploadUsageFile>]>([
    [
      'a document a connector syncs into Knowledge',
      {
        document: storedDocument('doc-file', {
          sourceProvider: 'onedrive',
          sourceMode: 'auto',
        }),
      },
    ],
    [
      // A project's Files tab reads who owns the document, not how it came
      // in: a connector's document has no Delete there, synced or not.
      "a connector's document in an open project",
      {
        document: storedDocument('doc-file', {
          sourceProvider: 'onedrive',
          sourceMode: 'manual',
        }),
        place: {
          type: 'project',
          id: 'proj-1',
          name: 'Riverside',
          archived: false,
          open: true,
        },
      },
    ],
    [
      'a chat attachment',
      {
        kind: 'chatAttachments',
        document: null,
        place: { type: 'chat', id: 'thread-1', title: 'Budget', open: true },
      },
    ],
    [
      'a document in an archived project',
      {
        place: {
          type: 'project',
          id: 'proj-1',
          name: 'Riverside',
          archived: true,
          open: true,
        },
      },
    ],
    [
      'a document in a project the person cannot open',
      {
        place: {
          type: 'project',
          id: null,
          name: null,
          archived: false,
          open: false,
        },
      },
    ],
  ])('offers no Delete for %s', async (_case, overrides) => {
    state.files = [storedFile('file', overrides)];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(await menuEntries(user, 'file.pdf')).toEqual(['Open']);
  });

  it('offers no Delete to a role that does not write documents', async () => {
    state.canWrite = false;
    state.files = [storedFile('file')];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(await menuEntries(user, 'file.pdf')).toEqual(['Open']);
  });

  it('opens an older version of a document but offers no Delete for it', async () => {
    // A delete removes the document with every version, so it is offered on
    // the current file alone.
    state.files = [
      storedFile('draft', {
        document: storedDocument('doc-plan', { current: false }),
      }),
    ];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(await menuEntries(user, 'draft.pdf')).toEqual(['Open']);
    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(
      await screen.findByRole('dialog', { name: 'Preview' }),
    ).toHaveTextContent('draft.pdf');
    expect(state.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, fileId: 'storage-draft' }),
    );
  });

  it('shows Delete unavailable, blocked by legal hold, while a hold covers the document', async () => {
    const hold = {
      _id: 'hold-1',
      targetType: 'document',
      targetId: 'doc-deck',
      placedAt: Date.UTC(2026, 9, 2),
      view: 'member',
      via: 'direct',
      hasPendingRelease: false,
      hasApprovedRelease: false,
    };
    state.legalHoldByTarget.mockImplementation(({ targetId }) => ({
      data: targetId === 'doc-deck' ? hold : null,
    }));
    state.files = [storedFile('deck')];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(state.legalHoldByTarget).toHaveBeenCalledWith({
      organizationId: 'org-1',
      targetType: 'document',
      targetId: 'doc-deck',
    });
    expect(await menuEntries(user, 'deck.pdf')).toEqual([
      'Open',
      'Blocked by legal hold',
    ]);
    const blocked = screen.getByRole('menuitem', {
      name: 'Blocked by legal hold',
    });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Open' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(blocked);
    expect(
      screen.queryByRole('dialog', { name: 'Delete document' }),
    ).toBeNull();
    expect(state.deleteDocument).not.toHaveBeenCalled();
  });

  it('shows Delete unavailable for a protected controlled record', async () => {
    state.files = [
      storedFile('procedure', {
        document: storedDocument('doc-procedure', { recordProtected: true }),
      }),
    ];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(await menuEntries(user, 'procedure.pdf')).toEqual([
      'Open',
      'Protected controlled record',
    ]);
    const blocked = screen.getByRole('menuitem', {
      name: 'Protected controlled record',
    });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');

    await user.click(blocked);
    expect(
      screen.queryByRole('dialog', { name: 'Delete document' }),
    ).toBeNull();
    expect(state.deleteDocument).not.toHaveBeenCalled();
  });

  it('deletes the document once the person confirms', async () => {
    state.files = [
      storedFile('deck', {
        document: storedDocument('doc-deck', { title: 'Q3 deck' }),
      }),
    ];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    const dialog = await askToDelete(user, 'deck.pdf');
    // The document's own title, as Knowledge names it.
    expect(dialog).toHaveTextContent(
      'Delete "Q3 deck"? This can\'t be undone.',
    );
    expect(state.deleteDocument).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(state.deleteDocument).toHaveBeenCalledTimes(1);
    expect(state.deleteDocument).toHaveBeenCalledWith({
      documentId: 'doc-deck',
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Delete document' }),
      ).toBeNull();
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('says why a refused delete failed, and keeps the confirmation open', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // The record went to review after the list was read, so its row still
    // offers Delete; the delete route answers with the record's refusal,
    // and the adapted mutation rejects with it.
    const refusal = toBackendError(
      backendApiErrorFromBody(400, {
        error: 'DOCUMENT_RECORD_PROTECTED',
        message:
          'This controlled record is in review and cannot be deleted. Resolve the review first.',
        data: { state: 'in_review' },
      }),
    );
    state.deleteDocument.mockRejectedValue(refusal);
    state.files = [storedFile('deck')];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    const dialog = await askToDelete(user, 'deck.pdf');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't delete the file — try again.",
        description:
          'This controlled record is in review and cannot be deleted. Resolve the review first.',
        variant: 'destructive',
      });
    });
    expect(state.deleteDocument).toHaveBeenCalledWith({
      documentId: 'doc-deck',
    });
    expect(
      screen.getByRole('dialog', { name: 'Delete document' }),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to delete a document from the storage list:',
      refusal,
    );
    consoleError.mockRestore();
  });

  it('opens the stored file in the preview, returning focus to its row menu', async () => {
    state.files = [storedFile('deck')];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    const menuButton = within(fileRow('deck.pdf')).getByRole('button', {
      name: 'Open menu',
    });
    await user.click(menuButton);
    await user.click(await screen.findByRole('menuitem', { name: 'Open' }));

    expect(
      await screen.findByRole('dialog', { name: 'Preview' }),
    ).toHaveTextContent('deck.pdf');
    const opened = state.preview.mock.calls
      .map(([props]) => props)
      .filter((props) => props.open);
    expect(opened.at(-1)).toMatchObject({
      fileId: 'storage-deck',
      fileName: 'deck.pdf',
    });
    expect(opened.at(-1)?.restoreFocusRef?.current).toBe(menuButton);
  });

  it('adds no preview to the page until Open is chosen', async () => {
    state.files = [storedFile('deck'), storedFile('plan')];

    const { user } = render(<UsageFiles organizationId="org-1" />);

    expect(fileRow('plan.pdf')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Document preview' }),
    ).toBeNull();
    expect(state.preview).not.toHaveBeenCalled();

    await user.click(
      within(fileRow('deck.pdf')).getByRole('button', { name: 'Open menu' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Open' }));

    // The row Open was chosen on mounts its preview; the other mounts none.
    expect(
      await screen.findByRole('dialog', { name: 'Preview' }),
    ).toHaveTextContent('deck.pdf');
    expect(
      screen.getAllByRole('region', { name: 'Document preview' }),
    ).toHaveLength(1);
  });

  it('says so when no file counts toward the limit', () => {
    render(<UsageFiles organizationId="org-1" />);

    expect(
      screen.getByText('No files count toward your storage limit'),
    ).toBeInTheDocument();
  });

  it('keeps the listed files under a notice when a refresh fails, with Try again', async () => {
    state.files = [storedFile('deck')];
    state.error = new Error('request failed');

    const { user } = render(<UsageFiles organizationId="org-1" />);

    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent("Couldn't load your files.");
    expect(fileRow('deck.pdf')).toBeInTheDocument();

    await user.click(within(notice).getByRole('button', { name: 'Try again' }));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  it('passes an accessibility audit', async () => {
    state.files = [
      storedFile('deck'),
      storedFile('plan', {
        place: {
          type: 'project',
          id: 'proj-1',
          name: 'Riverside',
          archived: true,
          open: true,
        },
      }),
      storedFile('photo', {
        kind: 'chatAttachments',
        document: null,
        place: { type: 'chat', id: 'thread-1', title: null, open: true },
      }),
      storedFile('binned', { inTrash: true }),
    ];

    const { container } = render(<UsageFiles organizationId="org-1" />);

    // The audit covers rows that carry their menu, not only the one in Trash.
    expect(screen.getAllByRole('button', { name: 'Open menu' })).toHaveLength(
      3,
    );
    await checkAccessibility(container);
  });
});
