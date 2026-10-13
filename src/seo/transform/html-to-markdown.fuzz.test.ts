/**
 * Property-style tests for `htmlToMarkdown`. We generate a corpus of
 * crafted + random HTML and assert invariants that must hold for any
 * input — most importantly, that no dangerous URL scheme survives the
 * conversion, because the output is served as markdown to humans and
 * LLMs and may eventually be re-rendered.
 */

import { describe, expect, it } from 'vitest';

import { htmlToMarkdown } from './html-to-markdown';

function rngFromSeed(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

const TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'a',
  'table',
  'tr',
  'td',
  'th',
  'div',
  'span',
] as const;

const SCHEMES = [
  'javascript:',
  'JAVASCRIPT:',
  '  javascript:alert(1)',
  '\tjavascript:foo',
  'vbscript:msgbox',
  'VbScript:foo',
];

function randomWord(rand: () => number, len = 5): string {
  const cps = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < len; i++) out += cps[Math.floor(rand() * cps.length)];
  return out;
}

function randomHtml(rand: () => number, depth = 3): string {
  if (depth === 0) return randomWord(rand);
  const tag = TAGS[Math.floor(rand() * TAGS.length)];
  if (tag === 'a') {
    const href =
      rand() < 0.5 ? '/foo' : SCHEMES[Math.floor(rand() * SCHEMES.length)];
    return `<a href="${href}">${randomWord(rand)}</a>`;
  }
  const kids: string[] = [];
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) kids.push(randomHtml(rand, depth - 1));
  return `<${tag}>${kids.join('')}</${tag}>`;
}

describe('htmlToMarkdown — properties', () => {
  it('never lets a javascript:/vbscript: scheme reach the markdown output', async () => {
    for (const scheme of SCHEMES) {
      const md = await htmlToMarkdown(`<p><a href="${scheme}">click</a></p>`);
      expect(md.toLowerCase()).not.toContain('javascript:');
      expect(md.toLowerCase()).not.toContain('vbscript:');
      // The anchor text survives as plain text inside the paragraph.
      expect(md).toContain('click');
    }
  });

  it('never produces unbalanced bracket sequences for the empty case', async () => {
    expect(await htmlToMarkdown('')).toBe('\n');
    expect(await htmlToMarkdown('<p></p>')).toBe('\n');
  });

  it('always returns trailing newline', async () => {
    const samples = [
      '<p>hi</p>',
      '<h1>x</h1>',
      '<ul><li>a</li></ul>',
      '<table><tr><th>a</th></tr><tr><td>b</td></tr></table>',
    ];
    for (const html of samples) {
      const md = await htmlToMarkdown(html);
      expect(md.endsWith('\n')).toBe(true);
    }
  });

  it('strips chrome tags entirely (script/style/nav/header/footer/aside)', async () => {
    const html = `
      <nav>nav content</nav>
      <header>header content</header>
      <footer>footer content</footer>
      <aside>aside content</aside>
      <script>alert(1)</script>
      <style>body{color:red}</style>
      <p>body content</p>
    `;
    const md = await htmlToMarkdown(html);
    expect(md).toContain('body content');
    expect(md).not.toContain('nav content');
    expect(md).not.toContain('header content');
    expect(md).not.toContain('footer content');
    expect(md).not.toContain('aside content');
    expect(md).not.toContain('alert(1)');
    expect(md).not.toContain('color:red');
  });

  it('survives random HTML without throwing and without leaking dangerous schemes', async () => {
    const rand = rngFromSeed(0xc0ffee);
    for (let i = 0; i < 30; i++) {
      const html = randomHtml(rand, 4);
      const md = await htmlToMarkdown(html);
      expect(typeof md).toBe('string');
      expect(md.toLowerCase()).not.toContain('javascript:');
      expect(md.toLowerCase()).not.toContain('vbscript:');
    }
  });

  it('treats role="navigation"/"banner"/"contentinfo" and aria-hidden the same as chrome tags', async () => {
    const html = `
      <div role="navigation">nav-role</div>
      <div role="banner">banner-role</div>
      <div role="contentinfo">footer-role</div>
      <div aria-hidden="true">hidden</div>
      <p>kept</p>
    `;
    const md = await htmlToMarkdown(html);
    expect(md).toContain('kept');
    expect(md).not.toContain('nav-role');
    expect(md).not.toContain('banner-role');
    expect(md).not.toContain('footer-role');
    expect(md).not.toContain('hidden');
  });
});
