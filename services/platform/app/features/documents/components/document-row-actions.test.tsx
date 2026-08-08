// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: null }),
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
  useOpenRecordRevision: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { DocumentRowActions } from './document-row-actions';

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
});
