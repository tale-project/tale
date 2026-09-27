// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { AssigneeAvatar } from './assignee-avatar';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

describe('AssigneeAvatar', () => {
  it.each(['user', 'agent', 'app'] as const)(
    'exposes the %s avatar as a named image',
    (assigneeType) => {
      render(
        <AssigneeAvatar
          assigneeType={assigneeType}
          assigneeId="actor-1"
          name="Issues Audit"
        />,
      );
      expect(screen.getByRole('img', { name: 'Issues Audit' })).toBeVisible();
    },
  );

  it('exposes the unassigned avatar as a named image', () => {
    render(<AssigneeAvatar />);
    expect(
      screen.getByRole('img', { name: 'assignee.unassigned' }),
    ).toBeVisible();
  });

  it('uses the muted chip for another human', () => {
    render(
      <AssigneeAvatar
        assigneeType="user"
        assigneeId="user-2"
        name="Jordan Lee"
      />,
    );
    const chip = screen.getByLabelText('Jordan Lee');
    expect(chip.className).toContain('bg-muted');
    expect(chip.className).not.toContain('bg-primary');
  });

  it('uses the filled primary chip when the assignee is the current user', () => {
    render(
      <AssigneeAvatar
        assigneeType="user"
        assigneeId="user-1"
        name="Alex"
        isCurrentUser
      />,
    );
    const chip = screen.getByLabelText('Alex');
    expect(chip.className).toContain('bg-primary');
    expect(chip.className).toContain('text-primary-foreground');
    expect(chip.className).not.toContain('bg-muted');
  });

  it('keeps the soft primary tint for agents even if isCurrentUser is set', () => {
    render(
      <AssigneeAvatar
        assigneeType="agent"
        assigneeId="research-bot"
        name="Research Bot"
        isCurrentUser
      />,
    );
    const chip = screen.getByLabelText('Research Bot');
    expect(chip.className).toContain('bg-primary/10');
    expect(chip.className).not.toContain('text-primary-foreground');
  });
});

// A bare `<span aria-label>` names nothing (axe aria-prohibited-attr): the
// chip is an image of the assignee, so it carries role="img".
describe('AssigneeAvatar semantics', () => {
  it('exposes a named assignee as an image', () => {
    render(
      <AssigneeAvatar assigneeType="user" assigneeId="user-2" name="Jordan" />,
    );
    expect(screen.getByRole('img', { name: 'Jordan' })).toBeInTheDocument();
  });

  it('exposes the unassigned placeholder as an image', () => {
    render(<AssigneeAvatar />);
    expect(
      screen.getByRole('img', { name: 'assignee.unassigned' }),
    ).toBeInTheDocument();
  });
});
