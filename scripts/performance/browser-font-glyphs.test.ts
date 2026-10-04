import { afterEach, expect, test } from 'bun:test';

import { JSDOM } from 'jsdom';

import type { Page } from '../../packages/e2e/src/index.ts';
import {
  assertCustomInterGlyphs,
  inspectRenderedFont,
  readGlyphTarget,
} from './browser/font-glyphs.ts';

const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});

test('a populated input uses its value, not empty textContent or its adjacent label', () => {
  const dom = new JSDOM(
    '<body><label>Wrong nearby text</label><input value="Seeded project" style="font-family:Inter;font-weight:400;font-style:normal;opacity:1"><input value="Second"></body>',
  );
  owned.push(dom);
  const input = dom.window.document.querySelector('input')!;
  input.getBoundingClientRect = () => ({ width: 100, height: 20 }) as DOMRect;
  const result = readGlyphTarget(input);
  expect(input.textContent).toBe('');
  expect(result.text).toBe('Seeded project');
  expect(result.input).toBe(true);
  expect(result.weight).toBe('400');
  expect(result.visible).toBe(true);
  expect(dom.window.document.querySelector(result.selector)).toBe(input);
});

test('DOM text and visible title input remain distinct targets', () => {
  const dom = new JSDOM(
    '<body><button style="opacity:1">Board title</button><input aria-label="Title" value="Dialog title" style="font-weight:600;opacity:1"></body>',
  );
  owned.push(dom);
  const button = dom.window.document.querySelector('button')!;
  const input = dom.window.document.querySelector('input')!;
  for (const element of [button, input])
    element.getBoundingClientRect = () =>
      ({ width: 100, height: 20 }) as DOMRect;
  expect(readGlyphTarget(button)).toMatchObject({
    input: false,
    text: 'Board title',
  });
  expect(readGlyphTarget(input)).toMatchObject({
    input: true,
    text: 'Dialog title',
    weight: '600',
  });
  input.remove();
  expect(() => readGlyphTarget(input)).toThrow('disconnected');
});

test('empty, system, wrong-weight and mixed glyph fonts cannot certify required Inter', () => {
  const regular = {
    familyName: 'Inter',
    postScriptName: 'Inter-Regular',
    isCustomFont: true,
    glyphCount: 20,
  };
  expect(() => assertCustomInterGlyphs([regular], 400)).not.toThrow();
  for (const fonts of [
    [],
    [{ ...regular, glyphCount: 0 }],
    [{ ...regular, isCustomFont: false }],
    [{ ...regular, postScriptName: 'Inter-Medium' }],
    [regular, { ...regular, familyName: 'Arial', isCustomFont: false }],
  ])
    expect(() => assertCustomInterGlyphs(fonts, 400)).toThrow();
  expect(() =>
    assertCustomInterGlyphs(
      [
        {
          familyName: 'Inter SemiBold',
          postScriptName: 'Inter-SemiBold',
          isCustomFont: true,
          glyphCount: 10,
        },
      ],
      600,
    ),
  ).not.toThrow();
});

test('glyph inspection preserves empty/input proof failure and detaches its owned CDP session', async () => {
  const observed = {
    selector: 'html > body > input',
    input: true,
    text: 'Project',
    family: 'Inter, sans-serif',
    weight: '400',
    style: 'normal',
    visible: true,
  };
  for (const failEnable of [false, true]) {
    let detached = 0;
    const page = {
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string) => {
            if (method === 'CSS.enable' && failEnable)
              throw new Error('CSS session failed');
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
            if (method === 'DOM.querySelector') return { nodeId: 2 };
            if (method === 'CSS.getPlatformFontsForNode') return { fonts: [] };
            return {};
          },
          detach: async () => {
            detached += 1;
          },
        }),
      }),
    } as unknown as Page;
    const target = {
      count: async () => 1,
      scrollIntoViewIfNeeded: async () => {},
      evaluate: async () => observed,
    } as unknown as ReturnType<Page['locator']>;
    const result = await inspectRenderedFont(
      page,
      target,
      { text: 'Project', weight: 400 },
      1000,
    );
    expect(result.complete).toBe(false);
    expect(result.target?.input).toBe(true);
    expect(result.error).toContain(
      failEnable ? 'CSS session failed' : 'no observed glyph font',
    );
    if (!failEnable) expect(result.fonts).toEqual([]);
    expect(detached).toBe(1);
  }
});
