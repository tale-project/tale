import { Inbox, Layers, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen } from '@/tests/utils/render';

import { SegmentedControl } from './segmented-control';

const options = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
];

function ControlledSegments({
  onValueChange,
  disabled,
  disabledOption,
}: {
  onValueChange: (value: string) => void;
  disabled?: boolean;
  disabledOption?: boolean;
}) {
  const [value, setValue] = useState('all');
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl
        aria-label="Which pages to show"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
        options={[
          { value: 'all', label: 'All' },
          { value: 'failed', label: 'Failed (26)', disabled: disabledOption },
          { value: 'skipped', label: 'Skipped (3)' },
        ]}
      />
      <button type="button">After</button>
    </>
  );
}

describe('SegmentedControl', () => {
  it('checks the focused option on arrows, Home and End and remains one Tab stop', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <ControlledSegments onValueChange={onValueChange} />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
    await user.tab();
    const all = screen.getByRole('radio', { name: 'All' });
    const failed = screen.getByRole('radio', { name: 'Failed (26)' });
    const skipped = screen.getByRole('radio', { name: 'Skipped (3)' });
    expect(all).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();

    for (const [key, target, value] of [
      ['{ArrowRight}', failed, 'failed'],
      ['{ArrowLeft}', all, 'all'],
      ['{End}', skipped, 'skipped'],
      ['{Home}', all, 'all'],
      ['{ArrowLeft}', skipped, 'skipped'],
      ['{ArrowRight}', all, 'all'],
    ] as const) {
      onValueChange.mockClear();
      await user.keyboard(key);
      expect(target).toHaveFocus();
      expect(target).toHaveAttribute('aria-checked', 'true');
      expect(
        screen
          .getAllByRole('radio')
          .filter((radio) => radio.getAttribute('aria-checked') === 'true'),
      ).toEqual([target]);
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith(value);
    }
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(all).toHaveFocus();
    expect(onValueChange).toHaveBeenCalledTimes(1);
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  });

  it('skips a disabled option during keyboard navigation and pointer activation', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <ControlledSegments onValueChange={onValueChange} disabledOption />,
    );
    const all = screen.getByRole('radio', { name: 'All' });
    const failed = screen.getByRole('radio', { name: 'Failed (26)' });
    const skipped = screen.getByRole('radio', { name: 'Skipped (3)' });
    expect(failed).toBeDisabled();
    await user.click(all);
    for (const key of ['{ArrowRight}', '{ArrowDown}', '{End}']) {
      await user.keyboard(key);
      expect(skipped).toHaveFocus();
      expect(skipped).toHaveAttribute('aria-checked', 'true');
      expect(onValueChange).toHaveBeenLastCalledWith('skipped');
      await user.keyboard('{Home}');
      expect(all).toHaveFocus();
      expect(all).toHaveAttribute('aria-checked', 'true');
    }
    await user.keyboard('{ArrowLeft}');
    expect(skipped).toHaveFocus();
    expect(skipped).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowUp}');
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute('aria-checked', 'true');
    await user.click(failed);
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(onValueChange).not.toHaveBeenCalledWith('failed');
  });

  it('does not activate a disabled group or include it in the Tab order', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <ControlledSegments onValueChange={onValueChange} disabled />,
    );
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
      await user.click(radio);
    }
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('does not select on ordinary focus after a navigation key stays on the current option', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <ControlledSegments onValueChange={onValueChange} />,
    );
    const all = screen.getByRole('radio', { name: 'All' });
    const failed = screen.getByRole('radio', { name: 'Failed (26)' });
    await user.click(all);
    await user.keyboard('{Home}');
    expect(all).toHaveFocus();
    act(() => failed.focus());
    expect(failed).toHaveFocus();
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(onValueChange).not.toHaveBeenCalled();
    await user.keyboard(' ');
    expect(failed).toHaveAttribute('aria-checked', 'true');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('failed');
    onValueChange.mockClear();
    await user.keyboard('{Enter}');
    expect(failed).toHaveAttribute('aria-checked', 'true');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('is a radiogroup named by its visible label', () => {
    render(
      <SegmentedControl
        label="View"
        value="list"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeVisible();
  });

  it('takes an aria-label when there is no visible label', async () => {
    const { container } = render(
      <SegmentedControl
        aria-label="Unit"
        value="list"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Unit' })).toBeVisible();
    await checkAccessibility(container);
  });

  it('takes aria-labelledby when there is no visible label', () => {
    render(
      <>
        <span id="heading">Layout</span>
        <SegmentedControl
          aria-labelledby="heading"
          value="list"
          onValueChange={() => {}}
          options={options}
        />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeVisible();
  });

  it('lets a visible label win over aria-label', () => {
    render(
      <SegmentedControl
        label="View"
        aria-label="Ignored"
        value="list"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeVisible();
    expect(
      screen.queryByRole('radiogroup', { name: 'Ignored' }),
    ).not.toBeInTheDocument();
  });

  it('never clears the selection when the active option is pressed again', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <SegmentedControl
        aria-label="View"
        value="list"
        onValueChange={onValueChange}
        options={options}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(onValueChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Board' }));
    expect(onValueChange).toHaveBeenCalledWith('board');
  });
});

function IconLedSegments({
  onValueChange,
}: {
  onValueChange: (value: string) => void;
}) {
  const [value, setValue] = useState('all');
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl
        aria-label="Show"
        labels="selected"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
        options={[
          { value: 'all', label: 'All', icon: Layers },
          {
            value: 'chats',
            label: 'Chats',
            icon: MessageCircle,
            attention: '2 items need you',
          },
          { value: 'inbox', label: 'Inbox', icon: Inbox },
          { value: 'notes', label: 'Notes' },
        ]}
      />
      <button type="button">After</button>
    </>
  );
}

describe('SegmentedControl with labels="selected"', () => {
  it('names every option in full, its attention read after its label', () => {
    render(<IconLedSegments onValueChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Show' })).toBeVisible();
    expect(
      screen.getAllByRole('radio').map((radio) => radio.textContent),
    ).toEqual(['All', 'Chats, 2 items need you', 'Inbox', 'Notes']);
    expect(
      screen.getByRole('radio', { name: 'Chats, 2 items need you' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('draws the attention as one quiet dot the reader does not hear twice', () => {
    render(<IconLedSegments onValueChange={() => {}} />);
    const chats = screen.getByRole('radio', { name: /^Chats/ });
    // oxlint-disable-next-line testing-library/no-node-access -- the dot is decorative, so it has no role
    const dots = chats.querySelectorAll('[data-slot="attention-dot"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the chosen label alone and keeps an option without an icon labelled', async () => {
    const { user } = render(<IconLedSegments onValueChange={() => {}} />);
    const shown = () =>
      screen
        .getAllByRole('radio')
        .filter(
          (radio) =>
            radio
              // oxlint-disable-next-line testing-library/no-node-access -- the frame is how the label opens; it has no role
              .querySelector('[data-slot="segmented-label-frame"]')
              ?.getAttribute('data-shown') !== 'false',
        )
        .map((radio) => radio.textContent);
    expect(shown()).toEqual(['All', 'Notes']);
    await user.click(screen.getByRole('radio', { name: 'Inbox' }));
    expect(shown()).toEqual(['Inbox', 'Notes']);
  });

  it('keeps one Tab stop and moves the choice with the arrow keys', async () => {
    const onValueChange = vi.fn();
    const { user } = render(<IconLedSegments onValueChange={onValueChange} />);
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    const all = screen.getByRole('radio', { name: 'All' });
    expect(all).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    const notes = screen.getByRole('radio', { name: 'Notes' });
    expect(notes).toHaveFocus();
    expect(notes).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    const chats = screen.getByRole('radio', { name: /^Chats/ });
    expect(chats).toHaveFocus();
    expect(chats).toHaveAttribute('aria-checked', 'true');
    expect(onValueChange.mock.calls).toEqual([['notes'], ['all'], ['chats']]);
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });
});
