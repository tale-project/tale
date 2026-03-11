// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { DocumentPreviewImage } from '../document-preview-image';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => {
      const translations: Record<string, Record<string, string>> = {
        documents: {
          'preview.failedToLoad': 'Failed to load document',
          'preview.document': 'Document',
        },
        common: {
          'imagePreview.zoomIn': 'Zoom in',
          'imagePreview.zoomOut': 'Zoom out',
          'imagePreview.resetZoom': 'Reset zoom',
        },
      };
      return translations[ns]?.[key] ?? key;
    },
  }),
}));

afterEach(cleanup);

describe('DocumentPreviewImage', () => {
  it('renders an img element with the provided url', () => {
    render(
      <DocumentPreviewImage
        url="https://example.com/photo.jpg"
        fileName="photo.jpg"
      />,
    );

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg');
    expect(img).toHaveAttribute('alt', 'photo.jpg');
  });

  it('uses fallback alt text when no fileName is provided', () => {
    render(<DocumentPreviewImage url="https://example.com/photo.jpg" />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', 'Document');
  });

  it('shows loading skeleton initially', () => {
    const { container } = render(
      <DocumentPreviewImage url="https://example.com/photo.jpg" />,
    );

    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy();
  });

  it('hides loading skeleton after image loads', () => {
    const { container } = render(
      <DocumentPreviewImage url="https://example.com/photo.jpg" />,
    );

    const img = screen.getByRole('img');
    fireEvent.load(img);

    expect(container.querySelector('[class*="animate-pulse"]')).toBeFalsy();
  });

  it('shows error message when image fails to load', () => {
    render(<DocumentPreviewImage url="https://example.com/broken.jpg" />);

    const img = screen.getByRole('img');
    fireEvent.error(img);

    expect(screen.getByText('Failed to load document')).toBeInTheDocument();
  });

  it('applies object-contain styling for proper scaling', () => {
    render(<DocumentPreviewImage url="https://example.com/photo.jpg" />);

    const img = screen.getByRole('img');
    expect(img.className).toContain('object-contain');
  });

  it('renders zoom controls', () => {
    render(<DocumentPreviewImage url="https://example.com/photo.jpg" />);

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Zoom out' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reset zoom' }),
    ).toBeInTheDocument();
  });

  it('shows zoom percentage', () => {
    render(<DocumentPreviewImage url="https://example.com/photo.jpg" />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
