// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DocumentPreviewPDF } from './document-preview-pdf';

vi.mock('@tale/ui/i18n/client', () => ({
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

  // Regression (2026-09-26 evaluation, B-08): the page-number box was a bare
  // `<input type="number">` with no name.
  it('names the page-number input', async () => {
    render(<DocumentPreviewPDF url="https://example.com/file.pdf" />);

    expect(
      await screen.findByRole('spinbutton', { name: 'aria.pageNumber' }),
    ).toBeInTheDocument();
  });
});
