import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskSubjectFiles } from './task-subject-files';

const contractState: { current: unknown } = { current: null };
vi.mock('../hooks/use-task-subject-contract', () => ({
  useTaskSubjectContract: () => contractState.current,
}));

// Both leaf surfaces stubbed — this suite asserts the SWAP rule, not the
// folder card or the attachments zone themselves.
vi.mock(
  '@/app/features/automations/registry/connected/folder-upload-card',
  () => ({
    FolderUploadCard: (props: { folderId: string }) => (
      <div data-testid="folder-card">{props.folderId}</div>
    ),
  }),
);
vi.mock('./task-attachments', () => ({
  TaskAttachments: () => <div data-testid="task-attachments" />,
}));

const FOLDER_CONTRACT = {
  automationSlug: 'vat-return-desk',
  contract: { workflow: 'vat-return-desk', input: { kind: 'folder' } },
};

function renderSurface(over: Record<string, unknown> = {}) {
  return render(
    <TaskSubjectFiles
      organizationId="org_1"
      task={
        {
          projectId: 'proj_1',
          createdBy: 'vat-return-desk',
          createdByType: 'app',
          externalId: 'folder_1',
          ...over,
        } as never
      }
      attachments={[]}
      uploadingFiles={[]}
      canEdit
      onUpload={() => {}}
      onRemove={() => {}}
    />,
  );
}

beforeEach(() => {
  contractState.current = null;
});

describe('TaskSubjectFiles', () => {
  it('keeps the plain attachments zone for unowned tasks', () => {
    renderSurface();
    expect(screen.getByTestId('task-attachments')).toBeInTheDocument();
    expect(screen.queryByTestId('folder-card')).toBeNull();
  });

  it('swaps in the bound folder card for folder-input tasks', () => {
    contractState.current = FOLDER_CONTRACT;
    renderSurface();
    expect(screen.getByTestId('folder-card')).toHaveTextContent('folder_1');
    expect(screen.queryByTestId('task-attachments')).toBeNull();
  });

  it('keeps the attachments zone when the binding is missing', () => {
    contractState.current = FOLDER_CONTRACT;
    renderSurface({ externalId: undefined });
    expect(screen.getByTestId('task-attachments')).toBeInTheDocument();
  });
});
