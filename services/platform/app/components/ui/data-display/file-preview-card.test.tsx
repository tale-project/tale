import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { FilePreviewCard } from './file-preview-card';

describe('FilePreviewCard', () => {
  describe('rendering', () => {
    it('renders file name', () => {
      render(<FilePreviewCard fileName="document.pdf" />);
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    it('renders formatted file size when provided', () => {
      render(<FilePreviewCard fileName="document.pdf" fileSize={2048} />);
      expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    });

    it('does not render file size when omitted', () => {
      render(<FilePreviewCard fileName="document.pdf" />);
      expect(screen.queryByText(/KB|MB|B$/)).not.toBeInTheDocument();
    });

    it('renders document icon', () => {
      const { container } = render(<FilePreviewCard fileName="document.pdf" />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders remove button when onRemove is provided', () => {
      render(<FilePreviewCard fileName="document.pdf" onRemove={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: 'Remove file' }),
      ).toBeInTheDocument();
    });

    it('does not render remove button when onRemove is omitted', () => {
      render(<FilePreviewCard fileName="document.pdf" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <FilePreviewCard fileName="document.pdf" className="custom-class" />,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('interactions', () => {
    it('fires onRemove when remove button is clicked', async () => {
      const handleRemove = vi.fn();
      const { user } = render(
        <FilePreviewCard fileName="document.pdf" onRemove={handleRemove} />,
      );
      await user.click(screen.getByRole('button', { name: 'Remove file' }));
      expect(handleRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe('file size formatting', () => {
    it('renders bytes for files under 1KB', () => {
      render(<FilePreviewCard fileName="tiny.txt" fileSize={500} />);
      expect(screen.getByText('500 B')).toBeInTheDocument();
    });

    it('renders KB for files under 1MB', () => {
      render(<FilePreviewCard fileName="small.txt" fileSize={1024} />);
      expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    });

    it('renders MB for larger files', () => {
      render(
        <FilePreviewCard fileName="large.pdf" fileSize={1024 * 1024 * 3} />,
      );
      expect(screen.getByText('3.0 MB')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <FilePreviewCard
          fileName="report.pdf"
          fileSize={4096}
          onRemove={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
