import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from './markdown';
import { IncrementalMarkdown } from './streaming/incremental-markdown';

// `remark-math` + `rehype-katex` turn `$…$`/`$$…$$` into KaTeX markup — a
// `.katex` root, and `.katex-display` for block math. Before the plugins
// were wired the TeX showed verbatim (the delimiters survived as literal
// text), so asserting the `.katex` root exists AND no `$` delimiter remains
// locks the regression shut for both the static and streaming renderers.

describe('Markdown — KaTeX math', () => {
  it('renders inline `$…$` math via KaTeX (no display wrapper)', () => {
    const { container } = render(
      <Markdown>{'Euler: $e^{i\\pi} + 1 = 0$.'}</Markdown>,
    );

    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull();
    expect(container.textContent).not.toContain('$');
  });

  it('renders block `$$…$$` math via KaTeX display', () => {
    const { container } = render(
      <Markdown>
        {'$$\n\\int_0^1 x\\,\\mathrm{d}x = \\frac{1}{2}\n$$'}
      </Markdown>,
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.textContent).not.toContain('$$');
    // The TeX source survives in KaTeX's MathML annotation for a11y.
    expect(
      container.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent,
    ).toContain('\\int_0^1');
  });
});

describe('IncrementalMarkdown — KaTeX math through the sanitize chain', () => {
  it('renders inline and block math once fully revealed', () => {
    const content = 'Mass–energy: $E = mc^2$.\n\n$$\na^2 + b^2 = c^2\n$$';
    const { container } = render(
      <IncrementalMarkdown content={content} revealPosition={content.length} />,
    );

    // Two rendered expressions survive rehype-sanitize (`language-math`
    // matches the default `code` schema, so rehype-katex still fires).
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.textContent).not.toContain('$');
  });
});
