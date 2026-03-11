// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { ZoomPanViewer } from './zoom-pan-viewer';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'imagePreview.zoomIn': 'Zoom in',
        'imagePreview.zoomOut': 'Zoom out',
        'imagePreview.resetZoom': 'Reset zoom',
      };
      return translations[key] ?? key;
    },
  }),
}));

afterEach(cleanup);

describe('ZoomPanViewer', () => {
  const defaultProps = {
    src: 'https://example.com/image.jpg',
    alt: 'Test image',
  };

  describe('rendering', () => {
    it('renders an image with correct src and alt', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', defaultProps.src);
      expect(img).toHaveAttribute('alt', defaultProps.alt);
    });

    it('renders zoom in, zoom out, and reset buttons', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: 'Zoom in' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Zoom out' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Reset zoom' }),
      ).toBeInTheDocument();
    });

    it('shows 100% zoom by default', () => {
      render(<ZoomPanViewer {...defaultProps} />);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('applies imageClassName to the img element', () => {
      render(
        <ZoomPanViewer {...defaultProps} imageClassName="rounded-xl border" />,
      );

      const img = screen.getByRole('img');
      expect(img.className).toContain('rounded-xl');
      expect(img.className).toContain('border');
    });

    it('applies className to the container', () => {
      const { container } = render(
        <ZoomPanViewer {...defaultProps} className="custom-class" />,
      );

      expect(container.firstElementChild?.className).toContain('custom-class');
    });

    it('sets draggable to false on the image', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('draggable', 'false');
    });
  });

  describe('toolbar positions', () => {
    it('renders overlay toolbar by default', () => {
      const { container } = render(<ZoomPanViewer {...defaultProps} />);

      const toolbarWrapper = container.querySelector('.absolute.top-4');
      expect(toolbarWrapper).toBeInTheDocument();
    });

    it('renders inline toolbar when toolbarPosition is inline', () => {
      const { container } = render(
        <ZoomPanViewer {...defaultProps} toolbarPosition="inline" />,
      );

      const inlineWrapper = container.querySelector('.justify-end.mb-2');
      expect(inlineWrapper).toBeInTheDocument();
    });

    it('renders headerContent in overlay mode', () => {
      render(
        <ZoomPanViewer
          {...defaultProps}
          headerContent={<span data-testid="header">file.jpg</span>}
        />,
      );

      expect(screen.getByTestId('header')).toBeInTheDocument();
    });
  });

  describe('zoom controls', () => {
    it('increments zoom on zoom in click', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(screen.getByText('125%')).toBeInTheDocument();
    });

    it('decrements zoom on zoom out click', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      // First zoom in, then zoom out
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('resets zoom on reset click', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(screen.getByText('150%')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('disables reset button when not zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
    });

    it('enables reset button when zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(
        screen.getByRole('button', { name: 'Reset zoom' }),
      ).not.toBeDisabled();
    });
  });

  describe('callbacks', () => {
    it('calls onLoad when image loads', () => {
      const onLoad = vi.fn();
      render(<ZoomPanViewer {...defaultProps} onLoad={onLoad} />);

      fireEvent.load(screen.getByRole('img'));
      expect(onLoad).toHaveBeenCalledOnce();
    });

    it('calls onError when image fails', () => {
      const onError = vi.fn();
      render(<ZoomPanViewer {...defaultProps} onError={onError} />);

      fireEvent.error(screen.getByRole('img'));
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe('image transform', () => {
    it('applies scale transform to image', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      expect(img.style.transform).toContain('scale(1)');
    });

    it('updates transform when zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

      const img = screen.getByRole('img');
      expect(img.style.transform).toContain('scale(1.25)');
    });
  });
});
