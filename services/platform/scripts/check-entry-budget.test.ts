import { describe, expect, it } from 'vitest';

import {
  findForbiddenPreloads,
  forbiddenPackagesIn,
  forbiddenSourcesIn,
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
    'assets/vendor-flow-C9ChwxHL.js',
    'assets/vendor-katex-DhW3chhM.js',
  ];

  it('names the editor, math and flow-canvas chunks and accepts everything else', () => {
    expect(findForbiddenPreloads(urls)).toEqual([
      'assets/vendor-codemirror-BT13JVA8.js',
      'assets/vendor-flow-C9ChwxHL.js',
      'assets/vendor-katex-DhW3chhM.js',
    ]);
  });

  it('does not mistake a chunk that merely mentions the name', () => {
    expect(
      findForbiddenPreloads(['assets/katex-settings-dialog-abc12345.js']),
    ).toEqual([]);
  });
});

describe('forbiddenPackagesIn', () => {
  it('names the charts, the flow canvas, KaTeX and the single-page libraries a chunk carries', () => {
    expect(
      forbiddenPackagesIn([
        '../../app/main.tsx',
        '../../../../node_modules/recharts/es6/chart/LineChart.js',
        '../../../../node_modules/@xyflow/react/dist/esm/index.js',
        '../../../../node_modules/katex/dist/katex.mjs',
        '../../../../node_modules/jszip/dist/jszip.min.js',
        '../../../../node_modules/ajv/dist/ajv.js',
        '../../../../node_modules/yaml/browser/index.js',
        '../../../../node_modules/cron-parser/dist/index.js',
        '../../../../node_modules/@tanstack/table-core/build/lib/index.mjs',
        '../../../../node_modules/dompurify/dist/purify.es.mjs',
      ]),
    ).toEqual([
      'recharts',
      '@xyflow/react',
      'katex',
      'jszip',
      'ajv',
      'yaml',
      'cron-parser',
      '@tanstack/table-core',
      'dompurify',
    ]);
  });

  it('passes a chunk that only shares their names or helpers', () => {
    expect(
      forbiddenPackagesIn([
        '../../../../node_modules/rehype-katex/lib/index.js',
        '../../../../node_modules/recharts-scale/es6/index.js',
        '../../app/features/analytics/usage/usage-metrics-search.ts',
      ]),
    ).toEqual([]);
  });
});

describe('forbiddenSourcesIn', () => {
  const root = '/srv/platform';
  const mapDir = '/srv/platform/dist/assets';

  it("names the service's German, French and Swiss topic files a chunk carries", () => {
    expect(
      forbiddenSourcesIn(
        [
          '../../messages/en/chat.yml',
          '../../messages/de/chat.yml',
          '../../messages/fr/settings.yml',
          '../../messages/de-CH/chat.yml',
        ],
        mapDir,
        root,
      ),
    ).toEqual(['messages/de/', 'messages/fr/', 'messages/de-CH/']);
  });

  it('names the large English topics the first pages do not read', () => {
    expect(
      forbiddenSourcesIn(
        ['../../messages/en/settings.yml', '../../messages/en/governance.yml'],
        mapDir,
        root,
      ),
    ).toEqual(['messages/en/settings.yml', 'messages/en/governance.yml']);
  });

  it("passes the English the first pages read and a package's catalog of the same name", () => {
    expect(
      forbiddenSourcesIn(
        [
          '../../../../packages/ui/src/i18n/messages/de.yml',
          '../../messages/en/chat.yml',
        ],
        mapDir,
        root,
      ),
    ).toEqual([]);
  });
});
