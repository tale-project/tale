// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DocumentPreviewPDF } from './document-preview-pdf';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

// The worker import resolves to an asset URL; stub it so it's side-effect-free.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'blob:worker',
}));

const getDocument = vi.fn(() => ({
  promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
}));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}));

// The real viewer reads its core API from `globalThis.pdfjsLib` when it loads.
// Mirror that: the mock throws the same error if the global isn't set yet,
// so the test fails if the component imports the viewer too early.
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  if (!globalThis.pdfjsLib) {
    throw new Error(
      "Cannot destructure property 'AbortException' of 'globalThis.pdfjsLib' as it is undefined.",
    );
  }
  class SimpleLinkService {
    externalLinkTarget = 0;
  }
  return {
    SimpleLinkService,
    TextLayerBuilder: class {},
    AnnotationLayerBuilder: class {},
  };
});

describe('DocumentPreviewPDF pdfjs bootstrap', () => {
  beforeEach(() => {
    getDocument.mockClear();
    globalThis.pdfjsLib = undefined;
  });

  afterEach(() => {
    globalThis.pdfjsLib = undefined;
  });

  it('pins the core library onto globalThis.pdfjsLib before loading the viewer, then loads the document', async () => {
    // Loading the viewer before setting the global makes the mock throw, so
    // getDocument would never run.
    render(<DocumentPreviewPDF url="https://example.com/file.pdf" />);

    await waitFor(() => {
      expect(getDocument).toHaveBeenCalledWith('https://example.com/file.pdf');
    });
    expect(globalThis.pdfjsLib).toBeDefined();
  });
});
