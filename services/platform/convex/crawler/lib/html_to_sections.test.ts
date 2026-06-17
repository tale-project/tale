import { describe, expect, it } from 'vitest';

import { htmlToSections } from './html_to_sections';

describe('htmlToSections', () => {
  it('promotes the first h1 to the title', () => {
    const content = htmlToSections('<h1>My Title</h1><p>Body</p>');
    expect(content.title).toBe('My Title');
    expect(content.sections).toEqual([{ type: 'paragraph', text: 'Body' }]);
  });

  it('keeps subsequent h1s as headings', () => {
    const content = htmlToSections('<h1>First</h1><h1>Second</h1>');
    expect(content.title).toBe('First');
    expect(content.sections).toEqual([
      { type: 'heading', level: 1, text: 'Second' },
    ]);
  });

  it('maps heading levels h2..h6', () => {
    const content = htmlToSections('<h2>Two</h2><h3>Three</h3>');
    expect(content.sections).toEqual([
      { type: 'heading', level: 2, text: 'Two' },
      { type: 'heading', level: 3, text: 'Three' },
    ]);
  });

  it('parses unordered and ordered lists', () => {
    const content = htmlToSections(
      '<ul><li>a</li><li>b</li></ul><ol><li>1</li><li>2</li></ol>',
    );
    expect(content.sections).toEqual([
      { type: 'bullets', items: ['a', 'b'] },
      { type: 'numbered', items: ['1', '2'] },
    ]);
  });

  it('parses a table with thead headers and tbody rows', () => {
    const content = htmlToSections(
      '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(content.sections).toEqual([
      { type: 'table', headers: ['H1', 'H2'], rows: [['1', '2']] },
    ]);
  });

  it('treats a leading all-th row as headers when no thead', () => {
    const content = htmlToSections(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table>',
    );
    expect(content.sections).toEqual([
      { type: 'table', headers: ['A', 'B'], rows: [['x', 'y']] },
    ]);
  });

  it('generates generic column headers when none are present', () => {
    const content = htmlToSections(
      '<table><tr><td>x</td><td>y</td></tr></table>',
    );
    expect(content.sections).toEqual([
      { type: 'table', headers: ['Column 1', 'Column 2'], rows: [['x', 'y']] },
    ]);
  });

  it('normalises ragged rows to the header width', () => {
    const content = htmlToSections(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>only</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>',
    );
    const table = content.sections[0];
    expect(table.type).toBe('table');
    expect(table.rows).toEqual([
      ['only', ''],
      ['1', '2'],
    ]);
  });

  it('parses blockquotes and code blocks', () => {
    const content = htmlToSections(
      '<blockquote>Quote me</blockquote><pre><code>const x = 1;\nconst y = 2;</code></pre>',
    );
    expect(content.sections).toEqual([
      { type: 'quote', text: 'Quote me' },
      { type: 'code', text: 'const x = 1;\nconst y = 2;' },
    ]);
  });

  it('recurses into container tags', () => {
    const content = htmlToSections('<div><p>Inside</p></div>');
    expect(content.sections).toEqual([{ type: 'paragraph', text: 'Inside' }]);
  });

  it('skips script and style tags', () => {
    const content = htmlToSections(
      '<p>Visible</p><script>evil()</script><style>.a{}</style>',
    );
    expect(content.sections).toEqual([{ type: 'paragraph', text: 'Visible' }]);
  });

  it('falls back to a default title when no h1 exists', () => {
    const content = htmlToSections('<p>Only body</p>');
    expect(content.title).toBe('Untitled Document');
  });
});
