import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ISSUE_SEVERITY_ICON_CLASS, IssueSeverityIcon } from './issue-severity';

describe('IssueSeverityIcon', () => {
  it('is decoration unless it is given a name', () => {
    const { container } = render(<IssueSeverityIcon severity="error" />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('is an image with that name when it has one', () => {
    render(<IssueSeverityIcon severity="warning" label="Warning" />);
    expect(screen.getByRole('img', { name: 'Warning' })).toBeInTheDocument();
  });

  it('draws each severity in its own shape and colour', () => {
    const { container } = render(
      <>
        <IssueSeverityIcon severity="error" />
        <IssueSeverityIcon severity="warning" />
        <IssueSeverityIcon severity="info" />
      </>,
    );
    const icons = [...container.querySelectorAll('svg')];
    expect(icons.map((icon) => icon.getAttribute('class'))).toEqual([
      expect.stringContaining('lucide-circle-x'),
      expect.stringContaining('lucide-triangle-alert'),
      expect.stringContaining('lucide-info'),
    ]);
    expect(icons[1]).toHaveClass(
      ...ISSUE_SEVERITY_ICON_CLASS.warning.split(' '),
    );
  });
});
