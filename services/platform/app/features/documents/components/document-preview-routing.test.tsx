// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('./document-preview-image', () => ({
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

vi.mock('./document-preview-pdf', () => ({
  DocumentPreviewPDF: ({ url }: { url: string }) => (
    <div data-testid="pdf-preview" data-url={url} />
  ),
}));

vi.mock('./document-preview-docx', () => ({
  DocumentPreviewDocx: ({ url }: { url: string }) => (
    <div data-testid="docx-preview" data-url={url} />
  ),
}));

vi.mock('./document-preview-odt', () => ({
  DocumentPreviewOdt: ({ url }: { url: string }) => (
    <div data-testid="odt-preview" data-url={url} />
  ),
}));

vi.mock('./document-preview-xlsx', () => ({
  DocumentPreviewXlsx: ({ url }: { url: string }) => (
    <div data-testid="xlsx-preview" data-url={url} />
  ),
}));

vi.mock('./document-preview-text', () => ({
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

vi.mock('./document-preview-markdown', () => ({
  DocumentPreviewMarkdown: ({ url }: { url: string }) => (
    <div data-testid="markdown-preview" data-url={url} />
  ),
}));

// Track all promises from lazyComponent factories so we can resolve
// them before running any tests. vi.hoisted runs before vi.mock hoisting.
const { lazyPromises } = vi.hoisted(() => ({
  lazyPromises: [] as Promise<void>[],
}));

vi.mock('@/lib/utils/lazy-component', () => ({
  lazyComponent: (factory: () => Promise<{ default: unknown }>) => {
    let Resolved: React.ComponentType<Record<string, unknown>> | null = null;
    const p = factory().then((m) => {
      Resolved = m.default as React.ComponentType<Record<string, unknown>>;
    });
    lazyPromises.push(p);
    return function Lazy(props: Record<string, unknown>) {
      if (!Resolved) return null;
      return <Resolved {...props} />;
    };
  },
}));
import { DocumentPreview } from './document-preview';

// Resolve all lazy component factories before tests run.
// Since vi.mock makes dynamic imports synchronous, these promises
// resolve immediately in the microtask queue.
beforeAll(async () => {
  await Promise.all(lazyPromises);
});

describe('DocumentPreview routing', () => {
  it.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'])(
    'routes .%s files to image preview',
    (ext) => {
      render(
        <DocumentPreview
          url={`https://example.com/file.${ext}`}
          fileName={`photo.${ext}`}
        />,
      );

      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    },
  );

  it('routes .pdf files to PDF preview', () => {
    render(
      <DocumentPreview
        url="https://example.com/doc.pdf"
        fileName="report.pdf"
      />,
    );

    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument();
  });

  it('routes .docx files to DOCX preview', () => {
    render(
      <DocumentPreview
        url="https://example.com/doc.docx"
        fileName="report.docx"
      />,
    );

    expect(screen.getByTestId('docx-preview')).toBeInTheDocument();
  });

  it('routes .odt files to ODT preview', () => {
    render(
      <DocumentPreview
        url="https://example.com/doc.odt"
        fileName="report.odt"
      />,
    );

    expect(screen.getByTestId('odt-preview')).toBeInTheDocument();
  });

  it('routes an extension-less title to ODT preview via mimeType', () => {
    render(
      <DocumentPreview
        url="https://example.com/blob"
        fileName="Meeting notes"
        mimeType="application/vnd.oasis.opendocument.text"
      />,
    );

    expect(screen.getByTestId('odt-preview')).toBeInTheDocument();
  });

  it('routes uppercase image extensions correctly', () => {
    render(
      <DocumentPreview
        url="https://example.com/PHOTO.PNG"
        fileName="PHOTO.PNG"
      />,
    );

    expect(screen.getByTestId('image-preview')).toBeInTheDocument();
  });

  it('routes an extension-less title to text preview via mimeType', () => {
    render(
      <DocumentPreview
        url="https://example.com/blob"
        fileName="Getting started in Confluence"
        mimeType="text/plain"
      />,
    );

    expect(screen.getByTestId('text-preview')).toBeInTheDocument();
  });

  it.each(['md', 'mdx'])(
    'routes .%s files to rendered markdown preview',
    (ext) => {
      render(
        <DocumentPreview
          url={`https://example.com/report.${ext}`}
          fileName={`report.${ext}`}
        />,
      );

      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
      expect(screen.queryByTestId('text-preview')).not.toBeInTheDocument();
    },
  );

  it('routes an extension-less title to markdown preview via mimeType', () => {
    render(
      <DocumentPreview
        url="https://example.com/blob"
        fileName="Verification report"
        mimeType="text/markdown"
      />,
    );

    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
  });

  it('prefers mimeType over an unhelpful filename', () => {
    render(
      <DocumentPreview
        url="https://example.com/blob"
        fileName="report"
        mimeType="application/pdf"
      />,
    );

    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument();
  });
});
