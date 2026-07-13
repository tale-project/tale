import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { OperatorProjection } from '../types';
import { OutcomeStrip } from './outcome-strip';

vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: ({
    open,
    documentId,
    fileName,
  }: {
    open: boolean;
    documentId?: string;
    fileName?: string;
  }) =>
    open ? (
      <div
        data-testid="document-preview-dialog"
        data-document-id={documentId}
        data-file-name={fileName}
      />
    ) : null,
}));

function projection(
  overrides: Partial<OperatorProjection> & {
    steps: OperatorProjection['steps'];
  },
): OperatorProjection {
  return {
    status: 'completed',
    startedAt: 1,
    stages: ['deliver'],
    ...overrides,
  };
}

describe('OutcomeStrip', () => {
  it('renders nothing when no step opts into surface=outcome', () => {
    const { container } = render(
      <OutcomeStrip
        projection={projection({
          steps: [
            {
              stepSlug: 'work',
              name: 'Do work',
              stepType: 'sandbox',
              render: 'stream',
              partState: 'output_available',
              output: { summary: 'hi' },
            },
          ],
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('opens document preview for outcome artifacts (not a raw storage link)', async () => {
    const { user } = render(
      <OutcomeStrip
        projection={projection({
          steps: [
            {
              stepSlug: 'publish_return',
              name: 'File return.xml',
              stepType: 'action',
              render: 'artifact',
              partState: 'output_available',
              params: { surface: 'outcome' },
              output: {
                title: 'return.xml',
                documentId: 'd1',
                fileId: 'f1',
                action: 'created',
              },
              files: [
                { name: 'return.xml', url: 'https://example.com/return.xml' },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'return.xml' })).toBeNull();
    const open = screen.getByRole('button', { name: 'return.xml' });
    await user.click(open);
    const dialog = screen.getByTestId('document-preview-dialog');
    expect(dialog).toHaveAttribute('data-document-id', 'd1');
    expect(dialog).toHaveAttribute('data-file-name', 'return.xml');
  });

  it('previews by documentId even when storage URLs were not resolved', async () => {
    const { user } = render(
      <OutcomeStrip
        projection={projection({
          steps: [
            {
              stepSlug: 'publish_return',
              name: 'File return.xml',
              stepType: 'action',
              render: 'artifact',
              partState: 'output_available',
              params: { surface: 'outcome' },
              output: {
                title: 'return.xml',
                documentId: 'd1',
                fileId: 'f1',
                action: 'created',
              },
            },
          ],
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'return.xml' }));
    expect(screen.getByTestId('document-preview-dialog')).toHaveAttribute(
      'data-document-id',
      'd1',
    );
  });

  it('does not repeat status chrome across multiple openable files', () => {
    render(
      <OutcomeStrip
        projection={projection({
          steps: [
            {
              stepSlug: 'a',
              name: 'File a',
              stepType: 'action',
              render: 'artifact',
              partState: 'output_available',
              params: { surface: 'outcome' },
              output: {
                title: 'return.xml',
                documentId: 'd1',
                fileId: 'f1',
                action: 'created',
              },
            },
            {
              stepSlug: 'b',
              name: 'File b',
              stepType: 'action',
              render: 'artifact',
              partState: 'output_available',
              params: { surface: 'outcome' },
              output: {
                title: 'report.md',
                documentId: 'd2',
                fileId: 'f2',
                action: 'created',
              },
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'return.xml' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'report.md' }),
    ).toBeInTheDocument();
    expect(screen.queryAllByText('Done')).toHaveLength(0);
  });

  it('promises a muted slot per upcoming outcome step while the run is in flight', () => {
    render(
      <OutcomeStrip
        projection={projection({
          status: 'running',
          steps: [
            {
              stepSlug: 'publish_a',
              name: 'File artifact A into the folder',
              stepType: 'action',
              render: 'artifact',
              partState: 'upcoming',
              params: { surface: 'outcome' },
              promisedTitle: 'a.xml',
            },
            {
              stepSlug: 'publish_b',
              name: 'File artifact B overview',
              stepType: 'action',
              render: 'artifact',
              partState: 'upcoming',
              params: { surface: 'outcome' },
              promisedTitle: 'b.md',
            },
            {
              stepSlug: 'publish_c',
              name: 'File artifact C',
              stepType: 'action',
              render: 'artifact',
              partState: 'upcoming',
              params: { surface: 'outcome' },
              promisedTitle: 'c.csv',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(
      screen.queryByText('Working — results will appear here.'),
    ).toBeNull();
    expect(screen.getByText('a.xml')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
    expect(screen.getByText('c.csv')).toBeInTheDocument();
    expect(screen.getByText('Not ready yet.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('promises outcome slots when publish steps were skipped after the run parked for input', () => {
    // A completed run can leave earlier outcome steps `skipped` (routed around)
    // while the desk still waits on operator input for a follow-up pass.
    render(
      <OutcomeStrip
        projection={projection({
          status: 'completed',
          steps: [
            {
              stepSlug: 'publish_a',
              name: 'File artifact A into the folder',
              stepType: 'action',
              render: 'artifact',
              partState: 'skipped',
              params: { surface: 'outcome' },
              promisedTitle: 'a.xml',
            },
            {
              stepSlug: 'publish_b',
              name: 'File artifact B overview',
              stepType: 'action',
              render: 'artifact',
              partState: 'skipped',
              params: { surface: 'outcome' },
              promisedTitle: 'b.md',
            },
            {
              stepSlug: 'publish_c',
              name: 'File artifact C',
              stepType: 'action',
              render: 'artifact',
              partState: 'skipped',
              params: { surface: 'outcome' },
              promisedTitle: 'c.csv',
            },
          ],
        })}
      />,
    );
    expect(
      screen.queryByText(
        'No results yet — they will appear here once a run produces them.',
      ),
    ).toBeNull();
    expect(screen.getByText('a.xml')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
    expect(screen.getByText('c.csv')).toBeInTheDocument();
  });

  it('falls back to the step name when no promisedTitle was authored', () => {
    render(
      <OutcomeStrip
        projection={projection({
          status: 'running',
          steps: [
            {
              stepSlug: 'publish_summary',
              name: 'Publish the summary artifact',
              stepType: 'action',
              render: 'artifact',
              partState: 'upcoming',
              params: { surface: 'outcome' },
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText('Publish the summary artifact'),
    ).toBeInTheDocument();
  });

  it('keeps ready artifacts next to still-pending outcome slots', () => {
    render(
      <OutcomeStrip
        projection={projection({
          status: 'running',
          steps: [
            {
              stepSlug: 'publish_a',
              name: 'File artifact A into the folder',
              stepType: 'action',
              render: 'artifact',
              partState: 'output_available',
              params: { surface: 'outcome' },
              output: {
                title: 'a.xml',
                documentId: 'd1',
                fileId: 'f1',
                action: 'created',
              },
            },
            {
              stepSlug: 'publish_b',
              name: 'File artifact B overview',
              stepType: 'action',
              render: 'artifact',
              partState: 'upcoming',
              params: { surface: 'outcome' },
              promisedTitle: 'b.md',
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'a.xml' })).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
  });

  it('keeps the Outcome lane as an empty-state placeholder when a settled run produced no files', () => {
    render(
      <OutcomeStrip
        projection={projection({
          status: 'completed',
          steps: [
            {
              stepSlug: 'publish_return',
              name: 'File return.xml',
              stepType: 'action',
              render: 'artifact',
              partState: 'upcoming',
              params: { surface: 'outcome' },
            },
          ],
        })}
      />,
    );
    // A settled run with an outcome-annotated step but no files/errors renders
    // the Outcome section as a stable placeholder rather than vanishing.
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(screen.queryByText('File return.xml')).toBeNull();
    expect(screen.queryByText('Not ready yet.')).toBeNull();
    expect(
      screen.getByText(
        'No results yet — they will appear here once a run produces them.',
      ),
    ).toBeInTheDocument();
  });

  it('omits the Outcome entirely when the automation has no outcome-annotated step', () => {
    const { container } = render(
      <OutcomeStrip
        projection={projection({
          status: 'completed',
          steps: [
            {
              stepSlug: 'some_step',
              name: 'A step',
              stepType: 'action',
              render: 'status',
              partState: 'output_available',
            },
          ],
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
