// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../document-preview-image', () => ({
  DocumentPreviewImage: ({
    url,
    fileName,
  }: {
    url: string;
    fileName?: string;
  }) => (
    <div data-testid="image-preview" data-url={url} data-filename={fileName} />
  ),
}));

vi.mock('../document-preview-pdf', () => ({
  DocumentPreviewPDF: ({ url }: { url: string }) => (
    <div data-testid="pdf-preview" data-url={url} />
  ),
}));

vi.mock('../document-preview-docx', () => ({
  DocumentPreviewDocx: ({ url }: { url: string }) => (
    <div data-testid="docx-preview" data-url={url} />
  ),
}));

vi.mock('../document-preview-xlsx', () => ({
  DocumentPreviewXlsx: ({ url }: { url: string }) => (
    <div data-testid="xlsx-preview" data-url={url} />
  ),
}));

vi.mock('../document-preview-text', () => ({
  DocumentPreviewText: ({
    url,
    fileName,
  }: {
    url: string;
    fileName?: string;
  }) => (
    <div data-testid="text-preview" data-url={url} data-filename={fileName} />
  ),
}));

vi.mock('@/lib/utils/lazy-component', () => ({
  lazyComponent: (factory: () => Promise<{ default: unknown }>) => {
    let Component: React.ComponentType<Record<string, unknown>> | null = null;
    void factory().then((m) => {
      Component = m.default as React.ComponentType<Record<string, unknown>>;
    });
    return (props: Record<string, unknown>) => {
      if (!Component) return null;
      return <Component {...props} />;
    };
  },
}));

// Flush microtasks so lazy components resolve
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

import { DocumentPreview } from '../document-preview';

afterEach(cleanup);

describe('DocumentPreview routing', () => {
  it.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'])(
    'routes .%s files to image preview',
    async (ext) => {
      render(
        <DocumentPreview
          url={`https://example.com/file.${ext}`}
          fileName={`photo.${ext}`}
        />,
      );
      await flushMicrotasks();

      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    },
  );

  it('routes .pdf files to PDF preview', async () => {
    render(
      <DocumentPreview
        url="https://example.com/doc.pdf"
        fileName="report.pdf"
      />,
    );
    await flushMicrotasks();

    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument();
  });

  it('routes .docx files to DOCX preview', async () => {
    render(
      <DocumentPreview
        url="https://example.com/doc.docx"
        fileName="report.docx"
      />,
    );
    await flushMicrotasks();

    expect(screen.getByTestId('docx-preview')).toBeInTheDocument();
  });

  it('routes uppercase image extensions correctly', async () => {
    render(
      <DocumentPreview
        url="https://example.com/PHOTO.PNG"
        fileName="PHOTO.PNG"
      />,
    );
    await flushMicrotasks();

    expect(screen.getByTestId('image-preview')).toBeInTheDocument();
  });
});
