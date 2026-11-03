import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '@/tests/utils/render';

import { useDialogQueue } from './use-dialog-queue';

function Question({
  name,
  answer,
}: {
  name: string;
  answer: (value: string) => void;
}) {
  const [typed, setTyped] = useState('');
  return (
    <div role="group" aria-label={name}>
      <input
        aria-label={`${name} field`}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <button type="button" onClick={() => answer('yes')}>
        Answer {name}
      </button>
    </div>
  );
}

function Harness() {
  const { show, current } = useDialogQueue();
  const [answers, setAnswers] = useState<string[]>([]);
  const ask = (name: string) => {
    void show<string>((answer) => (
      <Question name={name} answer={answer} />
    )).then((value) => setAnswers((all) => [...all, `${name}: ${value}`]));
  };
  return (
    <>
      <button type="button" onClick={() => ask('first')}>
        Ask first
      </button>
      <button type="button" onClick={() => ask('second')}>
        Ask second
      </button>
      {current}
      <output>{answers.join(', ')}</output>
    </>
  );
}

describe('useDialogQueue', () => {
  it('shows nothing until something is asked', () => {
    renderApp(<Harness />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows one question at a time, in the order they were asked, and each answer reaches who asked', async () => {
    const { user } = renderApp(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Ask first' }));
    await user.click(screen.getByRole('button', { name: 'Ask second' }));

    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'first' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Answer first' }));

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'second' })).toBeVisible(),
    );
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('first: yes');

    await user.click(screen.getByRole('button', { name: 'Answer second' }));

    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(
      'first: yes, second: yes',
    );
  });

  it('gives the next question a fresh start: nothing of the one before is left in it', async () => {
    const { user } = renderApp(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Ask first' }));
    await user.click(screen.getByRole('button', { name: 'Ask second' }));
    await user.type(screen.getByLabelText('first field'), 'typed');

    await user.click(screen.getByRole('button', { name: 'Answer first' }));

    expect(await screen.findByLabelText('second field')).toHaveValue('');
  });
});
