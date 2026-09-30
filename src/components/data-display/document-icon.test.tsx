import { vi, describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { DocumentIcon } from './document-icon';

vi.mock('react-file-icon', () => ({
  FileIcon: ({ extension }: { extension: string }) => (
    <span data-testid="file-icon">{extension}</span>
  ),
  defaultStyles: {},
}));

describe('DocumentIcon', () => {
  describe('accessibility', () => {
    it('passes axe audit for file', async () => {
      const { container } = render(<DocumentIcon fileName="report.pdf" />);
      await checkAccessibility(container);
    });

    it('passes axe audit for folder', async () => {
      const { container } = render(
        <DocumentIcon fileName="Documents" isFolder />,
      );
      await checkAccessibility(container);
    });

    it('folder icon is an SVG', () => {
      const { container } = render(<DocumentIcon fileName="Folder" isFolder />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('icon resolution', () => {
    it('uses the resolved extension when the title has none', () => {
      const { getByTestId } = render(
        <DocumentIcon
          fileName="Getting started in Confluence"
          extension="txt"
        />,
      );
      expect(getByTestId('file-icon')).toHaveTextContent('txt');
    });

    it('prefers the resolved extension over the filename suffix', () => {
      const { getByTestId } = render(
        <DocumentIcon fileName="report.txt" extension="pdf" />,
      );
      expect(getByTestId('file-icon')).toHaveTextContent('pdf');
    });

    it('falls back to the filename suffix when no extension is resolved', () => {
      const { getByTestId } = render(<DocumentIcon fileName="report.pdf" />);
      expect(getByTestId('file-icon')).toHaveTextContent('pdf');
    });
  });
});
