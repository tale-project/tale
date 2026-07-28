// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';
import { render, screen } from '@/tests/utils/render';

// The declared deliverables are ANNOUNCED before a run files them, and the zone
// must look the same either way — one quiet line-up, never a framed and divided
// list that turns three files into a one-column table and restyles itself the
// moment a run lands (`main`'s OutcomeStrip behaviour).

const mocks = vi.hoisted(() => ({
  documents: [] as Array<{ _id: string; title: string; folderId?: string }>,
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: mocks.documents }),
}));

vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

import { TaskOutcomeFilesCard } from './task-outcome-files';

const FOLDER = 'folder_2026q2';

const contract: TaskSubjectContract = {
  workflow: 'vat-return-desk',
  input: { kind: 'folder' },
  outcome: { files: ['return.xml', 'report.md'] },
};

function renderCard() {
  return render(
    <TaskOutcomeFilesCard
      organizationId="org_1"
      projectId={'project_1' as Id<'projects'>}
      folderId={FOLDER as Id<'folders'>}
      contract={contract}
    />,
  );
}

/** The rendered deliverable list, or null when the zone stayed quiet. */
const list = (container: HTMLElement) => container.querySelector('ul');

describe('TaskOutcomeFilesCard', () => {
  beforeEach(() => {
    mocks.documents = [];
  });

  it('names every declared deliverable before a run files any of them', () => {
    const { container } = renderCard();

    expect(screen.getByText('return.xml')).toBeInTheDocument();
    expect(screen.getByText('report.md')).toBeInTheDocument();
    // Nothing to open yet — a promise is not a button.
    expect(screen.queryByRole('button')).toBeNull();
    expect(list(container)).toHaveAttribute('role', 'status');
  });

  it('opens a filed deliverable and leaves the promise for the rest', () => {
    mocks.documents = [{ _id: 'doc_1', title: 'return.xml', folderId: FOLDER }];
    renderCard();

    expect(
      screen.getByRole('button', { name: 'Open return.xml' }),
    ).toBeInTheDocument();
    expect(screen.getByText('report.md')).toBeInTheDocument();
  });

  // The regression this file exists for.
  it('keeps ONE unframed layout whether or not a run has filed anything', () => {
    const promised = renderCard();
    const promisedClass = list(promised.container)?.className ?? '';
    promised.unmount();

    mocks.documents = [
      { _id: 'doc_1', title: 'return.xml', folderId: FOLDER },
      { _id: 'doc_2', title: 'report.md', folderId: FOLDER },
    ];
    const filed = renderCard();
    const filedClass = list(filed.container)?.className ?? '';

    expect(filedClass).toBe(promisedClass);
    expect(filedClass).not.toMatch(/divide-y|rounded-lg border|\bborder\b/);
    // …and the fully-filed zone stops claiming anything is outstanding.
    expect(list(filed.container)).not.toHaveAttribute('role', 'status');
  });

  it('renders nothing when the contract declares no deliverables', () => {
    const { container } = render(
      <TaskOutcomeFilesCard
        organizationId="org_1"
        projectId={'project_1' as Id<'projects'>}
        folderId={FOLDER as Id<'folders'>}
        contract={{ workflow: 'vat-return-desk' }}
      />,
    );

    expect(list(container)).toBeNull();
  });
});
