import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { NeedsReviewPanel } from './needs-review-panel';

/**
 * A converted automation that LOOKS finished is the failure this panel exists
 * to prevent, so these tests hold it to naming every flagged node, showing the
 * converter's own reason verbatim, and getting the author to that node.
 */

const notes = [
  { node: 'send_digest', reason: 'the model was chosen for you' },
  { node: 'poll_status', reason: 'a per-item branch could not be flattened' },
];

describe('NeedsReviewPanel', () => {
  it('renders nothing when the conversion was faithful', () => {
    const { container } = render(
      <NeedsReviewPanel notes={[]} onSelectNode={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names every flagged node with the converter reason', () => {
    render(<NeedsReviewPanel notes={notes} onSelectNode={vi.fn()} />);
    expect(screen.getByText('the model was chosen for you')).toBeVisible();
    expect(
      screen.getByText('a per-item branch could not be flattened'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'send_digest' })).toBeVisible();
  });

  it('counts the flagged nodes in its heading', () => {
    render(<NeedsReviewPanel notes={notes} onSelectNode={vi.fn()} />);
    expect(screen.getByText('2 nodes need review')).toBeVisible();
  });

  it('takes the author to the node the note concerns', async () => {
    const onSelectNode = vi.fn();
    const { user } = render(
      <NeedsReviewPanel notes={notes} onSelectNode={onSelectNode} />,
    );
    await user.click(screen.getByRole('button', { name: 'poll_status' }));
    expect(onSelectNode).toHaveBeenCalledWith('poll_status');
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <NeedsReviewPanel notes={notes} onSelectNode={vi.fn()} />,
    );
    await checkAccessibility(container);
  });
});
