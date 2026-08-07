// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { AssigneeAvatar } from './assignee-avatar';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

describe('AssigneeAvatar', () => {
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
