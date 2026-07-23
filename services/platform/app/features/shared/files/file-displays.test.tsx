import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { FilePart } from './types';

// FilePartDisplay gates on live storage existence via useFileUrl; drive the
// three states (loading / exists / deleted) through this mutable holder. The
// real hook subscribes to Convex, which throws outside a live deployment.
let fileUrlData: string | null | undefined;
vi.mock('./use-file-url', () => ({
  useFileUrl: () => ({ data: fileUrlData }),
}));

import { FilePartDisplay } from './file-displays';

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
