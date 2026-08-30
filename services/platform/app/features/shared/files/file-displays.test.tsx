import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { FilePart } from './types';

// FilePartDisplay gates on live storage existence via useFileUrl; drive the
// three states (loading / exists / deleted) through this mutable holder. The
// real hook subscribes to Convex, which throws outside a live deployment.
// Calls are recorded so FileAttachmentDisplay tests can assert WHICH
// arguments were passed (the download-naming contract).
let fileUrlData: string | null | undefined;
const useFileUrlCalls: unknown[][] = [];
vi.mock('./use-file-url', () => ({
  useFileUrl: (...args: unknown[]) => {
    useFileUrlCalls.push(args);
    return { data: fileUrlData };
  },
}));

// FileAttachmentDisplay's audio-transcript lookup rides the adapter-aware
// read wrapper (a live provider or backend either way); not under test here.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined }),
}));

// The real preview dialog subscribes to Convex (document metadata, file URL).
// These are composition tests of the chips' wiring — which chip opens the
// dialog and with what identity — so stub it down to a queryable marker.
const previewDialogProps: Array<{ fileId?: string; fileName?: string }> = [];
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: (props: { fileId?: string; fileName?: string }) => {
    previewDialogProps.push(props);
    return <div role="dialog">{props.fileName}</div>;
  },
}));

import { FileAttachmentDisplay, FilePartDisplay } from './file-displays';

beforeEach(() => {
  useFileUrlCalls.length = 0;
  previewDialogProps.length = 0;
});

const STORAGE_URL =
  'http://localhost:3000/http_api/storage?id=kg2test123&filename=slide-1.jpg';

function part(overrides: Partial<FilePart> = {}): FilePart {
  return {
    type: 'file',
    mediaType: 'image/jpeg',
    filename: 'slide-1.jpg',
    url: STORAGE_URL,
    ...overrides,
  };
}

describe('FilePartDisplay', () => {
  it('renders an image part while the existence query is loading', () => {
    fileUrlData = undefined;
    render(<FilePartDisplay filePart={part()} />);
    expect(screen.getByRole('img', { name: 'slide-1.jpg' })).toBeDefined();
  });

  it('renders an image part when the file still exists', () => {
    fileUrlData = 'http://localhost:3000/api/storage/kg2test123';
    render(<FilePartDisplay filePart={part()} />);
    expect(screen.getByRole('img', { name: 'slide-1.jpg' })).toBeDefined();
  });

  // REGRESSION: run_code intermediates deleted by the agent (file_delete)
  // kept rendering as broken thumbnails — the part embeds a raw storage URL
  // that outlives the file.
  it('renders nothing when the storage object was deleted', () => {
    fileUrlData = null;
    const { container } = render(<FilePartDisplay filePart={part()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a deleted non-image file card', () => {
    fileUrlData = null;
    const { container } = render(
      <FilePartDisplay
        filePart={part({
          mediaType: 'application/pdf',
          filename: 'panda.pdf',
          url: 'http://localhost:3000/http_api/storage?id=kg2pdf&filename=panda.pdf',
        })}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('keeps rendering a part whose url is not a storage url (nothing to check)', () => {
    fileUrlData = null; // irrelevant — no storage id to resolve
    render(
      <FilePartDisplay
        filePart={part({ url: 'https://example.com/external.jpg' })}
      />,
    );
    expect(screen.getByRole('img', { name: 'slide-1.jpg' })).toBeDefined();
  });

  // REGRESSION (#2362): assistant-generated images rendered as a ~36px
  // thumbnail (object-cover) instead of a readable display size.
  it('renders an assistant-generated image at a readable display size', () => {
    fileUrlData = 'http://localhost:3000/api/storage/kg2test123';
    render(<FilePartDisplay filePart={part()} isAssistantImage />);
    const img = screen.getByRole('img', { name: 'slide-1.jpg' });
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');
  });

  // REGRESSION (#2362): the Edit affordance was hover-only (opacity-0), so it
  // was unreachable on touch/coarse pointers. It must be always-visible and
  // keyboard-focusable.
  it('renders a reachable, always-visible Edit button when editing is enabled', () => {
    fileUrlData = 'http://localhost:3000/api/storage/kg2test123';
    render(
      <FilePartDisplay
        filePart={part()}
        isAssistantImage
        onEditImage={vi.fn()}
      />,
    );
    const editButton = screen.getByRole('button', { name: 'Edit this image' });
    expect(editButton.className).not.toContain('opacity-0');
    expect(editButton.className).not.toContain('group-hover');
  });
});

function attachment(
  overrides: Partial<{
    fileName: string;
    fileType: string;
    previewUrl: string;
  }> = {},
) {
  return {
    fileId: 'storage-1',
    fileName: 'spec.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    ...overrides,
  };
}

// Document chips open the same preview dialog the documents surfaces use
// (render in place; the dialog's header owns the named Download for the
// rest). Images keep the inline thumbnail + lightbox and audio/video the
// browser's inline player, so only THOSE still resolve a URL — unnamed,
// because an attachment disposition would break inline rendering.
describe('FileAttachmentDisplay — preview + inline behavior', () => {
  it('opens the document preview dialog when a document chip is clicked', async () => {
    fileUrlData = undefined;
    const { user } = render(
      <FileAttachmentDisplay
        attachment={attachment()}
        organizationId="org_1"
      />,
    );

    // No URL fetch for document chips — the dialog resolves its own.
    expect(useFileUrlCalls).toEqual([['storage-1', true]]);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /spec\.pdf/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(previewDialogProps).toEqual([
      expect.objectContaining({ fileId: 'storage-1', fileName: 'spec.pdf' }),
    ]);
  });

  it('resolves an image without a file name so it keeps rendering inline', () => {
    fileUrlData = undefined;
    render(
      <FileAttachmentDisplay
        attachment={attachment({
          fileName: 'photo.png',
          fileType: 'image/png',
          previewUrl: 'blob:photo-1',
        })}
        organizationId="org_1"
        onImageClick={vi.fn()}
      />,
    );

    expect(useFileUrlCalls).toEqual([['storage-1', true]]);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps audio chips opening the inline player, not the preview dialog', () => {
    const PLAYER_URL = 'http://localhost:3000/api/storage/storage-1';
    fileUrlData = PLAYER_URL;
    render(
      <FileAttachmentDisplay
        attachment={attachment({
          fileName: 'memo.mp3',
          fileType: 'audio/mpeg',
        })}
        organizationId="org_1"
      />,
    );

    expect(useFileUrlCalls).toEqual([['storage-1', false]]);
    expect(screen.getByRole('link')).toHaveAttribute('href', PLAYER_URL);
  });
});
