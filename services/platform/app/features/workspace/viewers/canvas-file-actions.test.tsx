import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  CopyAction,
  DownloadTextAction,
  DownloadUrlAction,
  WrapAction,
} from './canvas-file-actions';

// Regression for #2364: these are icon-only `size="sm"` buttons. `@tale/ui`
// Button only maps `title` to the accessible name for the `icon`/`icon-sm`
// sizes, so with only `title` set they had an empty accessible name (WCAG
// 4.1.2). Each now carries an explicit `aria-label`; assert the name is present
// (role + name) and that axe's `button-name` rule passes.
//
// Names resolve from messages/en.json (chat.canvas.*).
describe('canvas file actions accessible names', () => {
  it('WrapAction is named', async () => {
    const { container } = render(
      <WrapAction wrap={false} onToggle={() => {}} />,
    );
    expect(
      screen.getByRole('button', { name: 'Toggle line wrap' }),
    ).toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('CopyAction is named', async () => {
    const { container } = render(<CopyAction content="hello world" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('DownloadTextAction is named', async () => {
    const { container } = render(
      <DownloadTextAction path="notes/report.md" content="x" />,
    );
    expect(
      screen.getByRole('button', { name: 'Download' }),
    ).toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('DownloadUrlAction is named', async () => {
    const { container } = render(
      <DownloadUrlAction
        filename="image.png"
        url="https://example.test/i.png"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Download' }),
    ).toBeInTheDocument();
    await checkAccessibility(container);
  });
});
