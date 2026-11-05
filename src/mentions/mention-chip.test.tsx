import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { MentionChip } from './mention-chip';

describe('MentionChip', () => {
  it('reads @ and the name, then what kind of actor it is', () => {
    const { container } = render(
      <p>
        Ask <MentionChip name="My Opus Agent #3" kindLabel="Agent" /> today
      </p>,
    );
    expect(container.querySelector('p')).toHaveTextContent(
      'Ask @My Opus Agent #3 (Agent) today',
    );
    const chip = container.querySelector('[data-slot="mention-chip"]');
    expect(chip?.querySelector('bdi')).toHaveTextContent('@My Opus Agent #3');
    expect(chip).not.toHaveAttribute('data-missing');
  });

  it('mutes a mention of someone who is gone and says why', () => {
    render(
      <MentionChip name="Research Bot" missing missingLabel="Deleted agent" />,
    );
    const chip = screen.getByTitle('Deleted agent');
    expect(chip).toHaveAttribute('data-missing', 'true');
    expect(chip).toHaveClass('text-muted-foreground');
    expect(chip).toHaveTextContent('@Research Bot (Deleted agent)');
  });

  it('carries what it names for a caller that maps it', () => {
    render(
      <MentionChip
        name="Ada"
        data-mention-kind="user"
        data-mention-id="u-1"
        title="ada@example.com"
      />,
    );
    const chip = screen.getByTitle('ada@example.com');
    expect(chip).toHaveAttribute('data-mention-id', 'u-1');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <p>
        <MentionChip name="Ada" kindLabel="Person" /> and{' '}
        <MentionChip name="Gone" missing missingLabel="No longer a member" />
      </p>,
    );
    await checkAccessibility(container);
  });
});
