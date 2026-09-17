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

function DocumentTable({ state }: { state: 'in_review' | 'approved' }) {
  const { columns } = useDocumentsTableConfig({
    onDocumentClick: onOpen,
    onDocumentView: vi.fn(),
    onFolderDeleted: vi.fn(),
    isLoadingTeams: false,
    teamMap: new Map(),
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
