import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';

import { micromarkCjkAttention } from '../micromark-cjk-attention';

const options = { extensions: [micromarkCjkAttention()] };

function render(md: string): string {
  return micromark(md, options).trim();
}

// ============================================================================
// CJK PUNCTUATION + EMPHASIS (THE BUG)
// ============================================================================

describe('CJK punctuation emphasis fix', () => {
  it('closes bold before CJK character after full-width parenthesis', () => {
    expect(render('**DMO（Dual Mode Off-Road）**是')).toBe(
      '<p><strong>DMO（Dual Mode Off-Road）</strong>是</p>',
    );
  });

  it('handles multiple bold spans with CJK punctuation', () => {
    expect(
      render(
        '**DMO（Dual Mode Off-Road）**是比亚迪专为硬派越野打造的**超级混动越野平台**',
      ),
    ).toBe(
      '<p><strong>DMO（Dual Mode Off-Road）</strong>是比亚迪专为硬派越野打造的<strong>超级混动越野平台</strong></p>',
    );
  });

  it('handles CJK punctuation on both sides of bold', () => {
    expect(render('）**粗体**（')).toBe('<p>）<strong>粗体</strong>（</p>');
  });

  it('handles CJK quotation marks', () => {
    expect(render('「**引用**」')).toBe('<p>「<strong>引用</strong>」</p>');
  });

  it('handles CJK corner brackets', () => {
    expect(render('【**标题**】')).toBe('<p>【<strong>标题</strong>】</p>');
  });

  it('handles full-width comma after bold', () => {
    expect(render('**粗体**，后续文字')).toBe(
      '<p><strong>粗体</strong>，后续文字</p>',
    );
  });

  it('handles CJK period after bold', () => {
    expect(render('**粗体**。')).toBe('<p><strong>粗体</strong>。</p>');
  });

  it('handles italic with CJK punctuation', () => {
    expect(render('）*斜体*（')).toBe('<p>）<em>斜体</em>（</p>');
  });

  it('handles bold+italic with CJK punctuation', () => {
    expect(render('）***粗斜体***（')).toBe(
      '<p>）<em><strong>粗斜体</strong></em>（</p>',
    );
  });
});

// ============================================================================
// REGRESSION: ASCII punctuation behavior unchanged
// ============================================================================

describe('ASCII punctuation unchanged', () => {
  it('handles ASCII parentheses around bold', () => {
    expect(render('(**bold**)')).toBe('<p>(<strong>bold</strong>)</p>');
  });

  it('handles ASCII quotes around bold', () => {
    expect(render('"**bold**"')).toBe(
      '<p>&quot;<strong>bold</strong>&quot;</p>',
    );
  });

  it('handles period after bold', () => {
    expect(render('**bold**.')).toBe('<p><strong>bold</strong>.</p>');
  });

  it('handles exclamation after bold', () => {
    expect(render('**bold**!')).toBe('<p><strong>bold</strong>!</p>');
  });
});

// ============================================================================
// REGRESSION: Standard emphasis behavior
// ============================================================================

describe('standard emphasis unchanged', () => {
  it('renders basic bold', () => {
    expect(render('**bold**')).toBe('<p><strong>bold</strong></p>');
  });

  it('renders basic italic', () => {
    expect(render('*italic*')).toBe('<p><em>italic</em></p>');
  });

  it('renders bold+italic', () => {
    expect(render('***bold italic***')).toBe(
      '<p><em><strong>bold italic</strong></em></p>',
    );
  });

  it('renders underscore emphasis', () => {
    expect(render('_underscore_')).toBe('<p><em>underscore</em></p>');
  });

  it('renders underscore strong', () => {
    expect(render('__strong__')).toBe('<p><strong>strong</strong></p>');
  });

  it('renders mixed bold and plain text', () => {
    expect(render('hello **world** test')).toBe(
      '<p>hello <strong>world</strong> test</p>',
    );
  });

  it('renders multiple bold spans', () => {
    expect(render('**first** and **second**')).toBe(
      '<p><strong>first</strong> and <strong>second</strong></p>',
    );
  });

  it('renders nested emphasis', () => {
    expect(render('**bold and *italic* inside**')).toBe(
      '<p><strong>bold and <em>italic</em> inside</strong></p>',
    );
  });

  it('preserves code spans', () => {
    expect(render('`code **here**`')).toBe('<p><code>code **here**</code></p>');
  });

  it('preserves escaped asterisks', () => {
    expect(render('\\*\\*not bold\\*\\*')).toBe('<p>**not bold**</p>');
  });
});

// ============================================================================
// CJK text without punctuation (no fix needed, should still work)
// ============================================================================

describe('CJK text without adjacent punctuation', () => {
  it('renders bold CJK text', () => {
    expect(render('这是**加粗**的文字')).toBe(
      '<p>这是<strong>加粗</strong>的文字</p>',
    );
  });

  it('renders italic CJK text', () => {
    expect(render('这是*斜体*的文字')).toBe('<p>这是<em>斜体</em>的文字</p>');
  });
});
