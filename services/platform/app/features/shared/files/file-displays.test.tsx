import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// FileAttachmentDisplay resolves inline media through useFileUrl; drive its
// answer through this mutable holder. Calls are recorded so the tests can
// assert WHICH arguments were passed (the download-naming contract).
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
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined }),
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

import { FileAttachmentDisplay } from './file-displays';

beforeEach(() => {
  useFileUrlCalls.length = 0;
  previewDialogProps.length = 0;
});

/** Every useFileUrl call carried `args`. How many renders the mount took
 * (a first render in a cold i18n namespace re-renders once it loads) is not
 * the contract — the arguments are. */
function expectUseFileUrlCalledWith(...args: unknown[]): void {
  expect(useFileUrlCalls.length).toBeGreaterThan(0);
  for (const call of useFileUrlCalls) expect(call).toEqual(args);
}

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
    expectUseFileUrlCalledWith('storage-1', true);
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

    expectUseFileUrlCalledWith('storage-1', true);
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

    expectUseFileUrlCalledWith('storage-1', false);
    expect(screen.getByRole('link')).toHaveAttribute('href', PLAYER_URL);
  });
});
