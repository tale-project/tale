import '@testing-library/jest-dom/vitest';
import { DataTable } from '@tale/ui/data-table/data-table';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';
import type { DocumentItem } from '@/types/documents';

import { useDocumentsTableConfig } from './use-documents-table-config';

import '@/app/globals.css';

vi.mock('../components/document-row-actions', () => ({
  DocumentRowActions: () => null,
}));
vi.mock('./actions', () => ({
  useRetryRagIndexing: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'owner' } }),
}));
vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org-test' }),
}));

afterEach(cleanup);

const name = 'ui-eval-r2-data-very-long-controlled-document-filename.txt';
const onOpen = vi.fn();

/** The widest realistic content per column, to hold each column's floor. */
const denseRows: DocumentItem[] = [
  {
    id: 'doc-dense',
    name: 'quarterly-report-final-v3.docx',
    type: 'file',
    size: 1023 * 1024,
    ragStatus: 'completed',
    ocrApplied: true,
    teamIds: ['t1', 't2'],
    createdByName: 'someone.with.a.long.name@example.com',
    lastModified: Date.UTC(2026, 11, 31, 23, 59),
    sourceProvider: 'onedrive',
    syncHealth: {
      configId: 'c1',
      provider: 'onedrive',
      status: 'failed',
      needsReauth: true,
      ownerUserId: 'owner',
    },
  },
  {
    id: 'doc-plain',
    name: 'x.pdf',
    type: 'file',
    size: 999,
    ragStatus: 'not_indexed',
    teamIds: [],
    createdByName: 'Larry Roberts',
    lastModified: Date.UTC(2026, 8, 6, 9, 5),
  },
  { id: 'folder', name: 'Folder', type: 'folder' },
];

function DenseDocumentTable() {
  const { columns } = useDocumentsTableConfig({
    onDocumentClick: onOpen,
    onDocumentView: vi.fn(),
    isLoadingTeams: false,
    nameOf: (id) => (id === 't1' ? 'Customer success' : 'Ops'),
  });
  return <DataTable columns={columns} data={denseRows} approxRowCount={3} />;
}

/** The width a cell's content wants when nothing clips it: a clone of the
 * cell laid out at `max-content` with every truncation undone. */
function contentNeed(td: HTMLElement): number {
  const style = getComputedStyle(td);
  const padding =
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;left:0;top:0;width:max-content;visibility:hidden';
  const clone = td.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return 0;
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    if (!(el instanceof HTMLElement)) continue;
    el.style.width = 'max-content';
    el.style.minWidth = '0';
    el.style.maxWidth = 'none';
    el.style.overflow = 'visible';
    el.style.textOverflow = 'clip';
    el.style.whiteSpace = 'nowrap';
  }
  clone.style.display = 'block';
  clone.style.padding = '0';
  box.appendChild(clone);
  document.body.appendChild(box);
  const width = clone.getBoundingClientRect().width + padding;
  box.remove();
  return width;
}

function DocumentTable({ state }: { state: 'in_review' | 'approved' }) {
  const { columns } = useDocumentsTableConfig({
    onDocumentClick: onOpen,
    onDocumentView: vi.fn(),
    isLoadingTeams: false,
    nameOf: () => undefined,
  });
  const rows: DocumentItem[] = [
    {
      id: 'doc-test',
      name,
      type: 'file',
      record: { state, version: 1 },
    },
  ];
  return <DataTable columns={columns} data={rows} approxRowCount={1} />;
}

describe('controlled document filename (real layout)', () => {
  it.each(['in_review', 'approved'] as const)(
    'keeps the filename visible and clickable beside its %s badge',
    async (state) => {
      await page.viewport(1280, 800);
      onOpen.mockClear();
      render(
        <div style={{ width: 1152 }}>
          <DocumentTable state={state} />
        </div>,
      );
      const opener = screen.getByRole('button', {
        name: `Open document ${name}`,
      });
      const badge = screen.getByText(
        state === 'approved' ? 'v1 · Approved' : 'v1 · In review',
      );
      const fileBox = opener.getBoundingClientRect();
      const badgeBox = badge.getBoundingClientRect();
      expect(fileBox.width).toBeGreaterThanOrEqual(80);
      expect(fileBox.right).toBeLessThanOrEqual(badgeBox.left);
      await page.getByRole('button', { name: `Open document ${name}` }).click();
      expect(onOpen).toHaveBeenCalledOnce();
    },
  );
});

// Regression (2026-09-26 evaluation, B-10): the columns summed to 1434 px, so
// on a 1440 px window (14 rem sidebar + 16 px gutters = 1184 px of card, 15 px
// of it the frame's own scrollbar) the table scrolled inside its card and the
// "Modified" header was clipped. The floor now fits that card, and each
// metadata column still holds its widest realistic content.
describe('documents column floor (real layout)', () => {
  it('fits the card of a 1440 px window without scrolling sideways', async () => {
    await page.viewport(1440, 900);
    render(
      <div style={{ width: 1169 }}>
        <DenseDocumentTable />
      </div>,
    );
    const table = screen.getByRole('table');
    expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(1169);
    const scrollport = table.closest('.overflow-x-auto');
    expect(scrollport).toBeInstanceOf(HTMLElement);
    if (!(scrollport instanceof HTMLElement)) return;
    expect(scrollport.scrollWidth).toBe(scrollport.clientWidth);
    const modified = screen.getByRole('columnheader', { name: 'Modified' });
    expect(modified.getBoundingClientRect().right).toBeLessThanOrEqual(
      scrollport.getBoundingClientRect().right,
    );
  });

  it('gives every metadata column room for its widest realistic content at the floor', async () => {
    await page.viewport(1440, 900);
    render(
      <div style={{ width: 700 }}>
        <DenseDocumentTable />
      </div>,
    );
    const headers = screen.getAllByRole('columnheader');
    const bodyRows = screen.getAllByRole('row').slice(1);
    // The filename and the e-mail in Uploaded by truncate by design (their
    // titles carry the value), and the team chips fold into "+n" — the other
    // columns must not clip.
    const truncating = new Set(['Document', 'Uploaded by', 'Teams']);
    for (const [index, header] of headers.entries()) {
      const label = header.textContent?.trim() ?? '';
      if (label === '' || truncating.has(label)) continue;
      const width = header.getBoundingClientRect().width;
      for (const row of bodyRows) {
        const cell = row.children[index];
        if (!(cell instanceof HTMLElement)) continue;
        expect(contentNeed(cell), `${label} at ${width}px`).toBeLessThanOrEqual(
          width,
        );
      }
    }
  });
});
