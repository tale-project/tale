import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReleaseBody, stripFullChangelogFooter } from './release-body';

describe('stripFullChangelogFooter', () => {
  it('removes a trailing Full Changelog compare link', () => {
    const input = [
      "## What's Changed",
      '* fix: something',
      '',
      '',
      '**Full Changelog**: https://github.com/tale-project/tale/compare/v0.3.1...v0.3.2',
    ].join('\n');

    expect(stripFullChangelogFooter(input)).toBe(
      ["## What's Changed", '* fix: something'].join('\n'),
    );
  });

  it('leaves bodies without a footer unchanged', () => {
    const input = '## Highlights\n\nShip it.';
    expect(stripFullChangelogFooter(input)).toBe(input);
  });
});

describe('ReleaseBody', () => {
  it('demotes markdown # / ## / ### so the page keeps a single h1', () => {
    render(
      <ReleaseBody
        markdown={[
          '# Release title',
          '',
          '## Security',
          '',
          '### Detail',
          '',
          'Body text.',
        ].join('\n')}
      />,
    );

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Release title' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Security' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 4, name: 'Detail' }),
    ).toBeTruthy();
  });

  it('does not render the trailing Full Changelog footer', () => {
    render(
      <ReleaseBody
        markdown={[
          "## What's Changed",
          '* fix: clock',
          '',
          '**Full Changelog**: https://github.com/example/repo/compare/v1...v2',
        ].join('\n')}
      />,
    );

    expect(screen.queryByText(/Full Changelog/i)).toBeNull();
    expect(screen.getByText(/fix: clock/)).toBeTruthy();
  });
});
