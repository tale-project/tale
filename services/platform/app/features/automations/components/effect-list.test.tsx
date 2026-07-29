import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { EffectList } from './effect-list';

/**
 * An effect is the record that something outside the platform changed, so the
 * list has to answer all three parts of the audit question — which node, which
 * integration, with what input — for every effect, including repeats.
 *
 * The JSON viewer is lazily imported and belongs to a third party; it is stood
 * in for here so the assertions stay about the effect record itself.
 */
vi.mock('@/app/components/ui/data-display/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json">{JSON.stringify(data)}</pre>
  ),
}));

const effects = [
  {
    node: 'send_digest',
    integration: 'slack.post_message',
    input: { text: 'a' },
  },
  {
    node: 'send_digest',
    integration: 'slack.post_message',
    input: { text: 'b' },
  },
  {
    node: 'file_ticket',
    integration: 'github.create_issue',
    input: { title: 'x' },
  },
];

describe('EffectList', () => {
  it('says plainly when a run changed nothing outside the platform', () => {
    render(<EffectList effects={[]} emptyMessage="Nothing happened" />);
    expect(screen.getByText('Nothing happened')).toBeVisible();
  });

  it('shows every effect, including a repeat of the same call', () => {
    render(<EffectList effects={effects} emptyMessage="none" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('slack.post_message')).toHaveLength(2);
  });

  it('names the integration, the node, and the exact input for each', () => {
    render(<EffectList effects={effects} emptyMessage="none" />);
    expect(screen.getByText('github.create_issue')).toBeVisible();
    expect(screen.getByText('from file_ticket')).toBeVisible();
    expect(screen.getByText(JSON.stringify({ title: 'x' }))).toBeVisible();
  });

  it('keeps the effects in the order they happened', () => {
    render(<EffectList effects={effects} emptyMessage="none" />);
    const payloads = screen
      .getAllByTestId('json')
      .map((element) => element.textContent);
    expect(payloads).toEqual([
      JSON.stringify({ text: 'a' }),
      JSON.stringify({ text: 'b' }),
      JSON.stringify({ title: 'x' }),
    ]);
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <EffectList effects={effects} emptyMessage="none" />,
    );
    await checkAccessibility(container);
  });
});
