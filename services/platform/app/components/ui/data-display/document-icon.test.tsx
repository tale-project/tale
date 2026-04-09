import { vi, describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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
});
