import { describe, expect, it } from 'vitest';

import {
  findForbiddenPreloads,
  findWatchedPreloads,
  parsePreloadedScripts,
} from './check-entry-budget.ts';

const HTML = `<!doctype html><html><head>
    <script type="module" crossorigin src="./assets/index-Cahlw_g9.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/rolldown-runtime-CMxvf4Kt.js">
    <link rel="modulepreload" crossorigin href="./assets/vendor-core-CbOiHmXj.js">
    <link rel="stylesheet" crossorigin href="./assets/index-q_C9OIPk.css">
    <link rel="modulepreload" crossorigin href="./assets/vendor-katex-DhW3chhM.js">
    <link rel="modulepreload" crossorigin href="./assets/index-Cahlw_g9.js">
  </head><body></body></html>`;

describe('parsePreloadedScripts', () => {
  it('lists the module script and every modulepreload once, in document order, without the ./ prefix', () => {
    expect(parsePreloadedScripts(HTML)).toEqual([
      'assets/index-Cahlw_g9.js',
      'assets/rolldown-runtime-CMxvf4Kt.js',
      'assets/vendor-core-CbOiHmXj.js',
      'assets/vendor-katex-DhW3chhM.js',
    ]);
  });

  it('answers nothing for a page without module scripts', () => {
    expect(parsePreloadedScripts('<html></html>')).toEqual([]);
  });
});

describe('findForbiddenPreloads', () => {
  const urls = [
    'assets/index-Cahlw_g9.js',
    'assets/vendor-codemirror-BT13JVA8.js',
    'assets/vendor-core-CbOiHmXj.js',
    'assets/vendor-katex-DhW3chhM.js',
  ];

  it('names the editor chunk and accepts everything else', () => {
    expect(findForbiddenPreloads(urls)).toEqual([
      'assets/vendor-codemirror-BT13JVA8.js',
    ]);
  });

  it('reports the math chunk as watched rather than forbidden', () => {
    expect(findWatchedPreloads(urls)).toEqual([
      'assets/vendor-katex-DhW3chhM.js',
    ]);
  });

  it('does not mistake a chunk that merely mentions the name', () => {
    expect(
      findForbiddenPreloads(['assets/katex-settings-dialog-abc12345.js']),
    ).toEqual([]);
  });
});
