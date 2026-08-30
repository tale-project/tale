import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// `FileAttachmentDisplay` (the real chat renderer) resolves its own preview
// URL via Convex and — for audio/video — an extra `useQuery` that requires a
// live `ConvexProvider`. This is a composition test of `TaskAttachments`'
// wiring (which attachment gets a click handler, what the lightbox shows),
// not of the renderer's internals, so stub it down to its two load-bearing
// bits: forward `onImageClick` (regression target for #2664) and render the
// file name so each row is queryable by role/name.
vi.mock('@/app/features/shared/files/file-displays', () => ({
  FileAttachmentDisplay: ({
    attachment,
    onImageClick,
  }: {
    attachment: { fileName: string };
    onImageClick?: () => void;
  }) => (
    <button type="button" onClick={onImageClick}>
      {attachment.fileName}
    </button>
  ),
}));

vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrls: () => ({ data: undefined }),
}));

import { TaskAttachments } from './task-attachments';

function fileAttachment(
  overrides: Partial<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    previewUrl: string;
  }> = {},
) {
  return {
    fileName: 'photo.png',
    fileType: 'image/png',
    fileSize: 1024,
    previewUrl: 'blob:photo-1',
    ...overrides,
    fileId: (overrides.fileId ?? 'storage-1') as string,
  };
}

describe('TaskAttachments — image lightbox (#2664)', () => {
  it('opens the image preview dialog when an image attachment is clicked', async () => {
    const { user } = render(
      <TaskAttachments
        attachments={[fileAttachment()]}
        uploadingFiles={[]}
        canEdit={false}
        organizationId="org_1"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'photo.png' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
  });

  it('does not wire a click handler for a non-image attachment', async () => {
    const pdf = fileAttachment({
      fileId: 'storage-2',
      fileName: 'spec.pdf',
      fileType: 'application/pdf',
      previewUrl: undefined,
    });
    const { user } = render(
      <TaskAttachments
        attachments={[pdf]}
        uploadingFiles={[]}
        canEdit={false}
        organizationId="org_1"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'spec.pdf' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigates between multiple image attachments in the lightbox', async () => {
    const first = fileAttachment({
      fileId: 'storage-1',
      fileName: 'first.png',
      previewUrl: 'blob:first',
    });
    const second = fileAttachment({
      fileId: 'storage-2',
      fileName: 'second.png',
      previewUrl: 'blob:second',
    });
    const { user } = render(
      <TaskAttachments
        attachments={[first, second]}
        uploadingFiles={[]}
        canEdit={false}
        organizationId="org_1"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'first.png' }));
    expect(screen.getByAltText('first.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByAltText('second.png')).toBeInTheDocument();
  });
});
