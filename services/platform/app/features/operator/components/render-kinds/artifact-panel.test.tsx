import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { RenderPart } from '../../types';
import { ArtifactPanel } from './artifact-panel';

function artifactPart(overrides: Partial<RenderPart>): RenderPart {
  return {
    render: 'artifact',
    partState: 'output_available',
    title: 'File return.xml',
    data: undefined,
    ...overrides,
  };
}

describe('ArtifactPanel', () => {
  it('summarizes a document create without exposing ids', () => {
    render(
      <ArtifactPanel
        part={artifactPart({
          data: {
            success: true,
            title: 'return.xml',
            documentId: 'doc_abc',
            fileId: 'kg_xyz',
            action: 'created',
          },
          files: [
            { name: 'return.xml', url: 'https://example.com/return.xml' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Filed return.xml')).toBeInTheDocument();
    expect(screen.queryByText(/doc_abc/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kg_xyz/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      'https://example.com/return.xml',
    );
  });

  it('summarizes skipped document upserts', () => {
    render(
      <ArtifactPanel
        part={artifactPart({
          data: {
            title: 'report.md',
            documentId: 'doc_1',
            fileId: 'kg_1',
            action: 'skipped',
            contentChanged: false,
          },
        })}
      />,
    );
    expect(
      screen.getByText('report.md already up to date'),
    ).toBeInTheDocument();
  });

  it('hides raw JSON behind technical details for unknown objects', async () => {
    const { user } = render(
      <ArtifactPanel
        part={artifactPart({
          data: { weird: true, documentId: 'should-not-show-open' },
        })}
      />,
    );
    expect(screen.getByText('No details to show.')).toBeInTheDocument();
    expect(screen.queryByText(/should-not-show-open/)).not.toBeInTheDocument();
    await user.click(screen.getByText('Technical details'));
    // JsonViewer lazy-loads its highlighter in jsdom.
    expect(await screen.findByText(/should-not-show-open/)).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe for a filed document', async () => {
      const { container } = render(
        <ArtifactPanel
          part={artifactPart({
            data: {
              title: 'return.xml',
              documentId: 'd',
              fileId: 'f',
              action: 'created',
            },
            files: [{ name: 'return.xml', url: 'https://example.com/r' }],
          })}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
