// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const mockOpenRevision = vi.fn();
let replacementDialogProps:
  | { open: boolean; recordState?: 'draft' | 'in_review' | 'approved' }
  | undefined;

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

let mockLegalHold: unknown = null;
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: mockLegalHold }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

vi.mock('../hooks/actions', () => ({
  useRetryRagIndexing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useCancelOneDriveSync: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFolder: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkDocumentControlled: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useOpenRecordRevision: () => ({
    mutateAsync: mockOpenRevision,
    isPending: false,
  }),
}));

vi.mock('./document-replace-file-dialog', () => ({
  DocumentReplaceFileDialog: (props: {
    open: boolean;
    recordState?: 'draft' | 'in_review' | 'approved';
  }) => {
    replacementDialogProps = props;
    return props.open ? <div>replace-file-dialog</div> : null;
  },
}));

import { DocumentRowActions } from './document-row-actions';

beforeEach(() => {
  vi.clearAllMocks();
  mockLegalHold = null;
  replacementDialogProps = undefined;
});

describe('DocumentRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit for file row actions', async () => {
      const { container } = render(
        <DocumentRowActions
          documentId="doc-1"
          itemType="file"
          name="test-document.pdf"
          sourceMode="manual"
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('stop sync visibility', () => {
    const openMenu = async () => {
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: 'common.actions.openMenu' }),
      );
    };

    it('offers stop-sync on a directly-selected single-file sync', async () => {
      render(
        <DocumentRowActions
          documentId="doc-1"
          itemType="file"
          name="Document 1.docx"
          sourceMode="auto"
          syncConfigId="cfg-file"
          isDirectlySelected
        />,
      );
      await openMenu();
      expect(
        screen.getByText('documents.actions.stopSync'),
      ).toBeInTheDocument();
    });

    it('hides stop-sync on a file synced as part of a folder', async () => {
      // The file carries the folder config id; stopping it here would cancel
      // the whole folder, so the file row must not offer it.
      render(
        <DocumentRowActions
          documentId="doc-2"
          itemType="file"
          name="Document 1.docx"
          sourceMode="auto"
          syncConfigId="cfg-folder"
          isDirectlySelected={false}
        />,
      );
      await openMenu();
      expect(
        screen.queryByText('documents.actions.stopSync'),
      ).not.toBeInTheDocument();
    });

    it('still offers stop-sync on a synced folder', async () => {
      render(
        <DocumentRowActions
          documentId="folder-1"
          itemType="folder"
          name="Meetings"
          syncConfigId="cfg-folder"
        />,
      );
      await openMenu();
      expect(
        screen.getByText('documents.actions.stopSync'),
      ).toBeInTheDocument();
    });
  });

  describe('reindex visibility (#2598)', () => {
    const openMenu = async () => {
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: 'common.actions.openMenu' }),
      );
    };

    it('offers reindex on a failed file (transient, retryable)', async () => {
      render(
        <DocumentRowActions
          documentId="doc-1"
          itemType="file"
          name="report.pdf"
          sourceMode="manual"
          ragStatus="failed"
        />,
      );
      await openMenu();
      expect(screen.getByText('documents.actions.reindex')).toBeInTheDocument();
    });

    it('hides reindex on a terminal `unsupported` file — no text extractor will ever succeed', async () => {
      render(
        <DocumentRowActions
          documentId="doc-2"
          itemType="file"
          name="Daily SCRUM stand-up.loop"
          sourceMode="auto"
          ragStatus="unsupported"
        />,
      );
      await openMenu();
      expect(
        screen.queryByText('documents.actions.reindex'),
      ).not.toBeInTheDocument();
    });
  });

  describe('controlled-record replacement', () => {
    const openMenu = async () => {
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: 'common.actions.openMenu' }),
      );
      return user;
    };

    it('offers file replacement for a controlled draft and opens its dialog', async () => {
      render(
        <DocumentRowActions
          documentId="doc-draft"
          itemType="file"
          name="procedure.pdf"
          sourceMode="manual"
          record={{
            state: 'draft',
            version: 2,
            currentFileId: 'storage-current',
          }}
        />,
      );
      const user = await openMenu();

      const action = screen.getByText('documents.record.actions.replaceFile');
      expect(action).toBeInTheDocument();
      await user.click(action);
      expect(screen.getByText('replace-file-dialog')).toBeInTheDocument();
      expect(replacementDialogProps?.recordState).toBe('draft');
    });

    it('offers replacement beside New revision for an approved record without opening a revision', async () => {
      render(
        <DocumentRowActions
          documentId="doc-approved"
          itemType="file"
          name="procedure.pdf"
          sourceMode="manual"
          record={{
            state: 'approved',
            version: 3,
            currentFileId: 'storage-approved',
          }}
        />,
      );
      const user = await openMenu();

      const replacement = screen.getByText(
        'documents.record.actions.replaceFile',
      );
      expect(
        screen.getByText('documents.record.actions.newRevision'),
      ).toBeInTheDocument();
      await user.click(replacement);

      expect(mockOpenRevision).not.toHaveBeenCalled();
      expect(screen.getByText('replace-file-dialog')).toBeInTheDocument();
      expect(replacementDialogProps?.recordState).toBe('approved');
    });

    it('hides replacement for uncontrolled and in-review documents', async () => {
      const { unmount } = render(
        <DocumentRowActions
          documentId="doc-plain"
          itemType="file"
          name="procedure.pdf"
          sourceMode="manual"
        />,
      );
      await openMenu();
      expect(
        screen.queryByText('documents.record.actions.replaceFile'),
      ).not.toBeInTheDocument();

      unmount();
      render(
        <DocumentRowActions
          documentId="doc-in-review"
          itemType="file"
          name="procedure.pdf"
          sourceMode="manual"
          record={{
            state: 'in_review',
            version: 1,
            currentFileId: 'storage-current',
          }}
        />,
      );
      await openMenu();
      expect(
        screen.queryByText('documents.record.actions.replaceFile'),
      ).not.toBeInTheDocument();
    });

    it('disables approved replacement when its current file identity is missing', async () => {
      render(
        <DocumentRowActions
          documentId="doc-approved"
          itemType="file"
          name="procedure.pdf"
          sourceMode="manual"
          record={{ state: 'approved', version: 1 }}
        />,
      );
      await openMenu();

      const action = screen
        .getByText('documents.record.actions.replaceFile')
        .closest('[role="menuitem"]');
      expect(action).toHaveAttribute('aria-disabled', 'true');
    });

    it('disables replacement while the document is on legal hold', async () => {
      mockLegalHold = { id: 'hold-1' };
      render(
        <DocumentRowActions
          documentId="doc-held"
          itemType="file"
          name="procedure.pdf"
          sourceMode="manual"
          record={{
            state: 'draft',
            version: 1,
            currentFileId: 'storage-current',
          }}
        />,
      );
      await openMenu();

      const blocked = screen
        .getByText('documents.record.replace.blockedByHold')
        .closest('[role="menuitem"]');
      expect(blocked).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
