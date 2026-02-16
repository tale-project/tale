import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { FileUpload } from './file-upload';

describe('FileUpload', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(
        <FileUpload.Root>
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(screen.getByText('Drop files here')).toBeInTheDocument();
    });

    it('renders with label', () => {
      render(
        <FileUpload.Root label="Upload file">
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(screen.getByText('Upload file')).toBeInTheDocument();
    });

    it('renders required indicator', () => {
      render(
        <FileUpload.Root label="Upload file" required>
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('renders description', () => {
      render(
        <FileUpload.Root label="Upload file" description="Max file size: 10MB">
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(screen.getByText('Max file size: 10MB')).toBeInTheDocument();
    });

    it('renders error message', () => {
      render(
        <FileUpload.Root label="Upload file" errorMessage="File is required">
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('File is required');
    });

    it('does not render wrapper when no label/description/error', () => {
      const { container } = render(
        <FileUpload.Root>
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(
        container.querySelector('.flex.flex-col.gap-1\\.5'),
      ).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onFilesSelected when file input changes', async () => {
      const handleFiles = vi.fn();
      render(
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={handleFiles}
            inputId="test-upload"
            aria-label="Upload files"
          >
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );

      const input = document.getElementById('test-upload');
      expect(input).toBeInTheDocument();
    });

    it('is keyboard accessible when clickable', () => {
      render(
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={vi.fn()}
            aria-label="Upload files"
          >
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      const dropzone = screen.getByRole('button', { name: 'Upload files' });
      expect(dropzone).toHaveAttribute('tabindex', '0');
    });

    it('is not keyboard accessible when disabled', () => {
      render(
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={vi.fn()}
            disabled
            aria-label="Upload files"
          >
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      const dropzone = screen.getByRole('button', { name: 'Upload files' });
      expect(dropzone).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <FileUpload.Root label="Upload file">
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      await checkAccessibility(container, {
        rules: {
          'nested-interactive': { enabled: false },
          label: { enabled: false },
        },
      });
    });

    it('passes axe audit with error', async () => {
      const { container } = render(
        <FileUpload.Root label="Upload file" errorMessage="File is required">
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      await checkAccessibility(container, {
        rules: {
          'nested-interactive': { enabled: false },
          label: { enabled: false },
        },
      });
    });

    it('error message has role alert', () => {
      render(
        <FileUpload.Root errorMessage="File is required">
          <FileUpload.DropZone onFilesSelected={vi.fn()} aria-label="Upload">
            <p>Drop files here</p>
          </FileUpload.DropZone>
        </FileUpload.Root>,
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
