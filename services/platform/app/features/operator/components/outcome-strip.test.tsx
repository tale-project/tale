import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { OperatorProjection } from '../types';
import { OutcomeStrip } from './outcome-strip';

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

  it('lists openable filed artifacts for outcome steps', () => {
    render(
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
    expect(screen.queryByText('Filed return.xml')).not.toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'return.xml' })).toHaveAttribute(
      'href',
      'https://example.com/return.xml',
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
              files: [
                { name: 'return.xml', url: 'https://example.com/return.xml' },
              ],
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
              files: [
                { name: 'report.md', url: 'https://example.com/report.md' },
              ],
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'return.xml' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'report.md' })).toBeInTheDocument();
    expect(screen.queryAllByText('Done')).toHaveLength(0);
  });
});
