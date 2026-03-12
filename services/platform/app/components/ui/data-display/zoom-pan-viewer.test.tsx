// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from '@testing-library/react';
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

  describe('drag/pan', () => {
    it('updates transform translate after pointer drag when zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      // Zoom in first so dragging is enabled
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

      const img = screen.getByRole('img');
      const container = img.parentElement;
      if (!container) throw new Error('container not found');

      fireEvent.pointerDown(container, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(container, { clientX: 150, clientY: 120 });
      fireEvent.pointerUp(container);

      // After dragging, transform should include a non-zero translate
      expect(img.style.transform).toContain('translate(');
      expect(img.style.transform).not.toBe('scale(1.25) translate(0px, 0px)');
    });

    it('does not pan when not zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      const container = img.parentElement;
      if (!container) throw new Error('container not found');

      fireEvent.pointerDown(container, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(container, { clientX: 150, clientY: 120 });
      fireEvent.pointerUp(container);

      expect(img.style.transform).toContain('translate(0px, 0px)');
    });
  });

  describe('resetTrigger', () => {
    it('resets zoom and pan when resetTrigger value changes', () => {
      const { rerender } = render(
        <ZoomPanViewer {...defaultProps} resetTrigger="a" />,
      );

      // Zoom in
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(screen.getByText('150%')).toBeInTheDocument();

      // Change resetTrigger
      rerender(<ZoomPanViewer {...defaultProps} resetTrigger="b" />);

      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  describe('zoom boundaries', () => {
    it('cannot zoom below minimum (100% default floor for zoom out button)', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      // At 100%, zoom out button should still be enabled (min is 0.5)
      // but clicking zoom out should decrease below 100%
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(screen.getByText('75%')).toBeInTheDocument();

      // Keep zooming out to hit the floor
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(screen.getByText('50%')).toBeInTheDocument();

      // At minimum (50%), further zoom out stays at 50%
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('cannot zoom above maximum (300%)', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      // Zoom in 8 times: 100 -> 125 -> 150 -> 175 -> 200 -> 225 -> 250 -> 275 -> 300
      for (let i = 0; i < 8; i++) {
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      }
      expect(screen.getByText('300%')).toBeInTheDocument();

      // Further zoom in stays at 300%
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(screen.getByText('300%')).toBeInTheDocument();
    });

    it('disables zoom in button at maximum', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      for (let i = 0; i < 8; i++) {
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      }

      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    });

    it('disables zoom out button at minimum', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));

      expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    });
  });

  describe('keyboard zoom', () => {
    function getContainer() {
      const img = screen.getByRole('img');
      const container = img.parentElement;
      if (!container) throw new Error('container not found');
      return container;
    }

    it('zooms in with + key', () => {
      render(<ZoomPanViewer {...defaultProps} />);
      const container = getContainer();

      act(() => {
        container.dispatchEvent(
          new KeyboardEvent('keydown', { key: '+', bubbles: true }),
        );
      });

      expect(screen.getByText('125%')).toBeInTheDocument();
    });

    it('zooms out with - key', () => {
      render(<ZoomPanViewer {...defaultProps} />);
      const container = getContainer();

      // First zoom in via button so we can zoom out
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(screen.getByText('125%')).toBeInTheDocument();

      act(() => {
        container.dispatchEvent(
          new KeyboardEvent('keydown', { key: '-', bubbles: true }),
        );
      });

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('resets zoom with 0 key', () => {
      render(<ZoomPanViewer {...defaultProps} />);
      const container = getContainer();

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(screen.getByText('150%')).toBeInTheDocument();

      act(() => {
        container.dispatchEvent(
          new KeyboardEvent('keydown', { key: '0', bubbles: true }),
        );
      });

      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  describe('dynamic tabIndex', () => {
    it('has tabIndex -1 when not zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      const container = img.parentElement;
      if (!container) throw new Error('container not found');
      expect(container).toHaveAttribute('tabindex', '-1');
    });

    it('has tabIndex 0 when zoomed', () => {
      render(<ZoomPanViewer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

      const img = screen.getByRole('img');
      const container = img.parentElement;
      if (!container) throw new Error('container not found');
      expect(container).toHaveAttribute('tabindex', '0');
    });
  });
});
