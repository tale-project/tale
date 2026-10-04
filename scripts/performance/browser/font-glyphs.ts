import assert from 'node:assert/strict';

import type { Page } from '../../../packages/e2e/src/index.ts';

export interface GlyphFont {
  familyName: string;
  postScriptName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

/** Serialized browser reader. Input values are the text under test, not a
 * nearby label or the empty DOM textContent of an input element. */
export function readGlyphTarget(element: Element) {
  const doc = element.ownerDocument;
  if (!element.isConnected || !doc.defaultView)
    throw new Error('Font target is disconnected');
  const style = doc.defaultView.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const input = element.matches('input,textarea');
  const text = input
    ? (element as HTMLInputElement).value
    : (element.textContent ?? '');
  const path: string[] = [];
  let current: Element | null = element;
  while (current) {
    if (path.length >= 40) throw new Error('Font target path is too deep');
    const tag = current.localName;
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.localName === tag) index += 1;
      sibling = sibling.previousElementSibling;
    }
    path.unshift(`${tag}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  const selector = path.join(' > ');
  if (doc.querySelector(selector) !== element)
    throw new Error('Font target selector does not identify the original node');
  return {
    selector,
    input,
    text,
    family: style.fontFamily,
    weight: style.fontWeight,
    style: style.fontStyle,
    visible:
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) > 0,
  };
}

export function assertCustomInterGlyphs(fonts: GlyphFont[], weight: number) {
  const postScriptName = {
    400: 'Inter-Regular',
    500: 'Inter-Medium',
    600: 'Inter-SemiBold',
    700: 'Inter-Bold',
  }[weight];
  assert(postScriptName, 'Unsupported required glyph weight');
  assert(fonts.length > 0, 'Required text has no observed glyph font');
  for (const font of fonts) {
    assert(
      font.isCustomFont === true &&
        Number.isInteger(font.glyphCount) &&
        font.glyphCount > 0 &&
        /^Inter(?:$|[ -])/.test(font.familyName) &&
        font.postScriptName === postScriptName,
      'Required text did not render entirely with its custom Inter face',
    );
  }
}

/** Only invoke in the separate functional context after all timed rows are
 * immutable. Enabling CSS inspection can refetch resources in Chromium141. */
export async function inspectRenderedFont(
  page: Page,
  target: ReturnType<Page['locator']>,
  expected: { text: string; weight: 400 | 500 | 600 | 700 },
  timeoutMs: number,
) {
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0);
  const deadline = performance.now() + Math.min(timeoutMs, 5000);
  const receipt: {
    complete: boolean;
    expected: typeof expected;
    target?: ReturnType<typeof readGlyphTarget>;
    fonts?: GlyphFont[];
    error?: string;
    cleanupError?: string;
    inspection: string;
  } = {
    complete: false,
    expected,
    inspection:
      'Separate post-timing functional context; CSS inspection may refetch resources',
  };
  let cdp:
    | Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>
    | undefined;
  const bounded = async <T>(operation: () => Promise<T>, cleanup = false) => {
    const remaining = cleanup ? 1000 : deadline - performance.now();
    assert(remaining > 0, 'Glyph proof deadline exceeded');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Glyph proof timed out')),
            remaining,
          );
        }),
      ]);
      if (!cleanup)
        assert(performance.now() <= deadline, 'Glyph proof deadline exceeded');
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    assert.equal(
      await bounded(() => target.count()),
      1,
      'Glyph target is ambiguous',
    );
    await bounded(() =>
      target.scrollIntoViewIfNeeded({
        timeout: Math.max(1, deadline - performance.now()),
      }),
    );
    const observed = await bounded(() => target.evaluate(readGlyphTarget));
    receipt.target = observed;
    assert.equal(observed.text, expected.text, 'Wrong glyph target text/value');
    assert(observed.visible, 'Glyph target is not visible');
    assert.equal(observed.weight, String(expected.weight));
    assert.equal(observed.style, 'normal');
    assert(
      /^['"]?Inter['"]?(?:,|$)/.test(observed.family),
      'Required target does not prefer Inter',
    );
    cdp = await bounded(() => page.context().newCDPSession(page));
    await bounded(() => cdp!.send('DOM.enable'));
    await bounded(() => cdp!.send('CSS.enable'));
    const { root } = await bounded(() => cdp!.send('DOM.getDocument'));
    const { nodeId } = await bounded(() =>
      cdp!.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: observed.selector,
      }),
    );
    assert(nodeId > 0, 'Original glyph target is missing');
    const { fonts } = await bounded(() =>
      cdp!.send('CSS.getPlatformFontsForNode', { nodeId }),
    );
    receipt.fonts = fonts;
    const after = await bounded(() => target.evaluate(readGlyphTarget));
    assert.deepEqual(after, observed, 'Glyph target changed during inspection');
    assertCustomInterGlyphs(fonts, expected.weight);
    receipt.complete = true;
  } catch (error) {
    receipt.error = String(error);
  } finally {
    if (cdp) {
      try {
        await bounded(() => cdp!.detach(), true);
      } catch (error) {
        receipt.cleanupError = String(error);
        receipt.complete = false;
      }
    }
  }
  return receipt;
}
