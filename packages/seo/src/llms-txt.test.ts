import { describe, expect, it } from 'vitest';

import { buildLlmsTxt } from './llms-txt';

describe('buildLlmsTxt', () => {
  it('emits title, blockquote, and a single section', () => {
    const out = buildLlmsTxt({
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      sections: [
        {
          heading: 'Pages',
          pages: [
            { title: 'Home', url: 'https://tale.dev/index.md' },
            {
              title: 'Pricing',
              url: 'https://tale.dev/pricing.md',
              description: 'Plans.',
            },
          ],
        },
      ],
    });

    expect(out).toContain('# Tale\n');
    expect(out).toContain('> Sovereign AI.');
    expect(out).toContain('## Pages');
    expect(out).toContain('- [Home](https://tale.dev/index.md)');
    expect(out).toContain('- [Pricing](https://tale.dev/pricing.md): Plans.');
  });

  it('inserts a preamble between blockquote and the first section', () => {
    const out = buildLlmsTxt({
      siteTitle: 'Tale',
      siteDescription: 'Desc.',
      preamble: 'Welcome.',
      sections: [{ heading: 'Pages', pages: [] }],
    });

    expect(out).toMatch(/> Desc\.\n\nWelcome\.\n\n## Pages/);
  });

  it('renders an Optional section last', () => {
    const out = buildLlmsTxt({
      siteTitle: 'Tale',
      siteDescription: 'Desc.',
      sections: [{ heading: 'Pages', pages: [] }],
      optional: [{ title: 'GitHub', url: 'https://github.com/tale' }],
    });

    const optionalIdx = out.indexOf('## Optional');
    const pagesIdx = out.indexOf('## Pages');
    expect(optionalIdx).toBeGreaterThan(pagesIdx);
    expect(out).toContain('- [GitHub](https://github.com/tale)');
  });

  it('renders a section intro between heading and pages', () => {
    const out = buildLlmsTxt({
      siteTitle: 'Tale',
      siteDescription: 'Desc.',
      sections: [
        {
          heading: 'Pages',
          intro: 'The main pages.',
          pages: [{ title: 'Home', url: 'https://tale.dev/index.md' }],
        },
      ],
    });

    expect(out).toMatch(/## Pages\n\nThe main pages\.\n\n- \[Home\]/);
  });

  it('skips an empty optional section', () => {
    const out = buildLlmsTxt({
      siteTitle: 'Tale',
      siteDescription: 'Desc.',
      sections: [{ heading: 'Pages', pages: [] }],
      optional: [],
    });

    expect(out).not.toContain('## Optional');
  });
});
