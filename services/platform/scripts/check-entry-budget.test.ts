import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkLazyChunk,
  dynamicImportersOf,
  findForbiddenPreloads,
  forbiddenPackagesIn,
  forbiddenSourcesIn,
  parsePreloadedScripts,
  staticClosure,
  staticImportsOf,
  type LazyBudget,
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
  it('names the charts, the flow canvas and its layout engine, KaTeX and the single-page libraries a chunk carries', () => {
    expect(
      forbiddenPackagesIn([
        '../../app/main.tsx',
        '../../../../node_modules/recharts/es6/chart/LineChart.js',
        '../../../../node_modules/@xyflow/react/dist/esm/index.js',
        '../../../../node_modules/elkjs/lib/elk-api.js',
        '../../../../node_modules/katex/dist/katex.mjs',
        '../../../../node_modules/jszip/dist/jszip.min.js',
        '../../../../node_modules/ajv/dist/ajv.js',
        '../../../../node_modules/yaml/browser/index.js',
        '../../../../node_modules/acorn/dist/acorn.mjs',
        '../../../../node_modules/periscopic/src/index.js',
        '../../../../node_modules/cron-parser/dist/index.js',
        '../../../../node_modules/@tanstack/table-core/build/lib/index.mjs',
        '../../../../node_modules/dompurify/dist/purify.es.mjs',
        '../../../../node_modules/diff/libesm/index.js',
      ]),
    ).toEqual([
      'recharts',
      '@xyflow/react',
      'elkjs',
      'katex',
      'jszip',
      'ajv',
      'yaml',
      'acorn',
      'periscopic',
      'cron-parser',
      '@tanstack/table-core',
      'dompurify',
      'diff',
    ]);
  });

  it("names the code editor's view and syntax trees, and the languages only code blocks read", () => {
    expect(
      forbiddenPackagesIn([
        '../../../../node_modules/@codemirror/view/dist/index.js',
        '../../../../node_modules/@lezer/common/dist/index.js',
        '../../../../node_modules/@codemirror/lang-html/dist/index.js',
        '../../../../node_modules/@codemirror/legacy-modes/mode/shell.js',
        '../../../../node_modules/@codemirror/language-data/dist/index.js',
        // The highlight tags the read-only code blocks share are fine.
        '../../../../node_modules/@lezer/highlight/dist/index.js',
      ]),
    ).toEqual([
      '@codemirror/view',
      '@lezer/common',
      '@codemirror/lang-html',
      '@codemirror/legacy-modes',
      '@codemirror/language-data',
    ]);
  });

  it('passes a chunk that only shares their names or helpers', () => {
    expect(
      forbiddenPackagesIn([
        '../../../../node_modules/rehype-katex/lib/index.js',
        '../../../../node_modules/recharts-scale/es6/index.js',
        '../../../../node_modules/diff-match-patch/index.js',
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

  it("names the automation editor's own screens, topics and engine a chunk carries", () => {
    expect(
      forbiddenSourcesIn(
        [
          '../../app/features/automations/components/automation-tests/automation-tests-panel.tsx',
          '../../app/features/automations/components/versions/version-compare-page.tsx',
          '../../messages/en/automations.yml',
          '../../messages/en/automationRuns.yml',
          '../../messages/en/automationIssues.yml',
          '../../lib/engine/api/expect.ts',
          '../../lib/engine/core/diff/automation.ts',
        ],
        mapDir,
        root,
      ),
    ).toEqual([
      'messages/en/automations.yml',
      'messages/en/automationRuns.yml',
      'messages/en/automationIssues.yml',
      'app/features/automations/components/',
      'lib/engine/',
    ]);
  });

  it('names the diffs, the test results, the dock and the flow components of @tale/ui a chunk carries', () => {
    const ui = '../../../../packages/ui/src';
    expect(
      forbiddenSourcesIn(
        [
          `${ui}/data/value-diff.ts`,
          `${ui}/components/data-display/code-diff/code-diff.tsx`,
          `${ui}/components/data-display/data-diff/data-diff.tsx`,
          `${ui}/components/feedback/test-results.tsx`,
          `${ui}/components/editor/workbench-dock.tsx`,
          `${ui}/components/flow/playback/flow-playback-bar.tsx`,
        ],
        mapDir,
        root,
      ),
    ).toEqual([
      '../../packages/ui/src/data/value-diff.ts',
      '../../packages/ui/src/components/data-display/code-diff/',
      '../../packages/ui/src/components/data-display/data-diff/',
      '../../packages/ui/src/components/feedback/test-results.tsx',
      '../../packages/ui/src/components/editor/workbench-dock.tsx',
      '../../packages/ui/src/components/flow/',
    ]);
  });

  it('passes what a route needs to match its address and the shared pieces the shell reads', () => {
    const ui = '../../../../packages/ui/src';
    expect(
      forbiddenSourcesIn(
        [
          '../../app/features/automations/lib/editor-search.ts',
          '../../app/features/automations/hooks/use-can-use-automations.ts',
          '../../lib/shared/schemas/automation-tests.ts',
          '../../lib/shared/utils/storable-text.ts',
          `${ui}/data/stable-stringify.ts`,
          `${ui}/components/data-display/value-tree/value-tree.tsx`,
          `${ui}/components/feedback/test-results-helpers.ts`,
        ],
        mapDir,
        root,
      ),
    ).toEqual([]);
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

describe('staticImportsOf', () => {
  it('reads the static imports and re-exports of a built chunk, not its dynamic ones', () => {
    const source = [
      'import{t as e}from"./vendor-core-abc.js";',
      'import"./side-effect-def.js";',
      'export{a as b}from"../assets/re-export-ghi.js";',
      'import * as n from "./namespace-jkl.js"',
      'const later=()=>import("./lazy-mno.js");',
    ].join('');
    expect(staticImportsOf(source, 'assets/code-editor-view-x.js')).toEqual([
      'assets/vendor-core-abc.js',
      'assets/side-effect-def.js',
      'assets/re-export-ghi.js',
      'assets/namespace-jkl.js',
    ]);
  });
});

describe('staticClosure', () => {
  it('follows every static import once, the start first', () => {
    const files: Record<string, string> = {
      'assets/a.js': 'import"./b.js";import"./c.js";',
      'assets/b.js': 'import"./c.js";',
      'assets/c.js': 'import"./a.js";const x=()=>import("./d.js");',
    };
    expect(staticClosure('assets/a.js', (url) => files[url] ?? '')).toEqual([
      'assets/a.js',
      'assets/b.js',
      'assets/c.js',
    ]);
  });
});

describe('dynamicImportersOf', () => {
  it('names the chunks that load one with import(), whatever their quotes', () => {
    const files: Record<string, string> = {
      'assets/a.js': 'const v=()=>h(()=>import(`./view-x.js`),[]);',
      'assets/b.js': "import('./view-x.js')",
      'assets/c.js': 'import"./view-x.js";',
      'assets/view-x.js': '',
    };
    expect(
      dynamicImportersOf(
        'assets/view-x.js',
        Object.keys(files),
        (url) => files[url] ?? '',
      ),
    ).toEqual(['assets/a.js', 'assets/b.js']);
  });
});

describe('checkLazyChunk', () => {
  const dists: string[] = [];
  afterEach(() => {
    for (const dist of dists.splice(0)) rmSync(dist, { recursive: true });
  });

  /** A built dist with these chunks and source maps. */
  function distWith(files: Record<string, string>): string {
    const dist = mkdtempSync(join(tmpdir(), 'entry-budget-'));
    dists.push(dist);
    mkdirSync(join(dist, 'assets'));
    for (const [path, text] of Object.entries(files)) {
      writeFileSync(join(dist, path), text);
    }
    return dist;
  }

  const budget: LazyBudget = {
    name: 'code-editor-view',
    maxGzip: 2048,
    packages: ['@codemirror/language-data'],
    text: ['eval(', 'new Function('],
  };

  it('counts what the chunk adds to the cold load and to its importer, and passes a clean one', () => {
    const dist = distWith({
      // The light editor's chunk loads the view, and has the helpers both
      // read already.
      'assets/inspector-d4.js':
        'import"./helpers-e5.js";const v=()=>import(`./code-editor-view-a1.js`);',
      'assets/helpers-e5.js': 'export const locate=1;',
      'assets/code-editor-view-a1.js':
        'import"./vendor-codemirror-b2.js";import"./vendor-core-c3.js";import"./helpers-e5.js";',
      'assets/vendor-codemirror-b2.js': 'export const view=1;',
      'assets/vendor-core-c3.js': 'export const react=1;',
    });
    const report = checkLazyChunk(dist, ['assets/vendor-core-c3.js'], budget);
    expect(report.chunks).toEqual([
      'assets/code-editor-view-a1.js',
      'assets/vendor-codemirror-b2.js',
    ]);
    expect(report.gzip).toBeGreaterThan(0);
    expect(report.problems).toEqual([]);
  });

  it('names a size over the budget, a forbidden package and code built from strings', () => {
    const big = Array.from({ length: 4000 }, (_, index) => `v${index * 7919}`);
    const dist = distWith({
      'assets/code-editor-view-a1.js': `import"./vendor-codemirror-b2.js";const x=${JSON.stringify(big)};`,
      'assets/vendor-codemirror-b2.js': 'const f=new Function("return 1");',
      'assets/vendor-codemirror-b2.js.map': JSON.stringify({
        sources: [
          '../../../../node_modules/@codemirror/language-data/dist/index.js',
        ],
      }),
    });
    const { problems } = checkLazyChunk(dist, [], budget);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/KB gzip, over its 2 KB/);
    expect(problems).toContain(
      'assets/vendor-codemirror-b2.js holds new Function(',
    );
    expect(problems).toContain(
      'assets/vendor-codemirror-b2.js carries @codemirror/language-data',
    );
  });

  it('says so when the chunk was not built', () => {
    const dist = distWith({ 'assets/index-a1.js': '' });
    expect(checkLazyChunk(dist, [], budget).problems).toEqual([
      'no code-editor-view chunk was built',
    ]);
  });
});
