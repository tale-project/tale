import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { stepTestNeeds } from '../../lib/automation-tests/step-test';
import { StepTestDialog } from './step-test-dialog';

const NEEDS = stepTestNeeds(
  {
    nodes: [
      { id: 'fetch', type: 'http.get', input: { url: '{{ input.url }}' } },
      {
        id: 'score',
        type: 'llm',
        forEach: '{{ nodes.fetch.output.items }}',
        prompt: 'Score {{ item.title }} for {{ input.team }}',
      },
    ],
  },
  'score',
);
if (NEEDS === null) throw new Error('score is in the document');

const field = (name: string) => screen.getByRole('textbox', { name });

describe('testing one node alone', () => {
  it('starts from the run on the canvas and runs the node on that data', async () => {
    const onRun = vi.fn();
    const { user } = render(
      <StepTestDialog
        needs={NEEDS}
        initial={{
          pins: { fetch: { value: { items: [{ title: 'A' }] }, from: 'run' } },
          input: { team: 'core' },
          item: 1,
        }}
        onClose={() => {}}
        onRun={onRun}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Test Score' })).toBeVisible();
    expect(screen.getByText('Uses data from')).toBeInTheDocument();
    expect(field('Fetch')).toHaveTextContent('"title": "A"');
    expect(
      screen.getByText(
        'From the run on the canvas. Change it to try other data.',
      ),
    ).toBeInTheDocument();
    expect(field('Run input (JSON)')).toHaveTextContent('"team": "core"');
    const item = screen.getByRole('spinbutton', { name: 'Item' });
    await user.clear(item);
    await user.type(item, '2');
    await user.click(screen.getByRole('button', { name: 'Test node' }));
    expect(onRun).toHaveBeenCalledWith(
      { team: 'core' },
      { only: 'score', mocks: { fetch: { items: [{ title: 'A' }] } }, item: 1 },
      {
        pins: { fetch: { items: [{ title: 'A' }] } },
        input: { team: 'core' },
        item: 2,
      },
    );
  });

  it('says a node read has no output yet, and holds the test on data that is no JSON', async () => {
    const { user } = render(
      <StepTestDialog
        needs={NEEDS}
        initial={{
          pins: { fetch: { value: null, from: 'none' } },
          input: {},
          item: 1,
        }}
        onClose={() => {}}
        onRun={() => {}}
      />,
    );
    expect(
      screen.getByText(
        'Fetch has no output to use yet. Write what it would return.',
      ),
    ).toBeInTheDocument();
    await user.click(field('Fetch'));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('{ nope');
    expect(screen.getByRole('button', { name: 'Test node' })).toBeDisabled();
  });
});
