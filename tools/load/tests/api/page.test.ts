import { describe, expect, test } from 'bun:test';

import { documentFiles, staticImports } from '../../src/api/page.ts';

describe('documentFiles', () => {
  test('what a browser fetches to show the document, against its base', () => {
    const html = `<!doctype html><html><head>
      <base href="/tale/">
      <meta charset="UTF-8" />
      <link rel="icon" href="./favicon.ico" sizes="any" />
      <link rel="alternate" type="text/plain" href="/llms.txt" />
      <link rel="preconnect" href="https://fonts.example.com" />
      <script>window.inline = true;</script>
      <script type="module" crossorigin src="./assets/app-1.js"></script>
      <script nomodule src="./assets/legacy.js"></script>
      <link rel="stylesheet" crossorigin href='./assets/app-1.css'>
      <link rel=modulepreload href=./assets/chunk-2.js>
      <link rel="manifest" href="./manifest.webmanifest">
      <link rel="apple-touch-icon" href="assets/touch.png">
      <script type="module" src="./assets/app-1.js"></script>
    </head></html>`;
    expect(
      documentFiles(html, 'https://tale.example.com/tale/dashboard/org-1'),
    ).toEqual([
      'https://tale.example.com/tale/favicon.ico',
      'https://tale.example.com/tale/assets/app-1.js',
      'https://tale.example.com/tale/assets/app-1.css',
      'https://tale.example.com/tale/assets/chunk-2.js',
      'https://tale.example.com/tale/manifest.webmanifest',
      'https://tale.example.com/tale/assets/touch.png',
    ]);
  });

  test('without a base, against the document itself', () => {
    expect(
      documentFiles(
        '<script type="module" src="./assets/a.js"></script>',
        'http://localhost/dashboard/org-1',
      ),
    ).toEqual(['http://localhost/dashboard/assets/a.js']);
  });
});

describe('staticImports', () => {
  test('a module’s static imports and re-exports, never its imports on demand', () => {
    const source = [
      'import{a as b}from"./vendor-core-1.js";',
      'import "./side-effect.js";',
      "export * from '../shared/x.js';",
      'export{c}from"/assets/abs.js";',
      'const lazy=()=>import("./screen-2.js");',
      'const later=()=>import(`./locale-3.js`);',
      'import React from "react";',
    ].join('\n');
    expect(
      staticImports(source, 'https://tale.example.com/assets/app-1.js'),
    ).toEqual([
      'https://tale.example.com/assets/vendor-core-1.js',
      'https://tale.example.com/assets/side-effect.js',
      'https://tale.example.com/shared/x.js',
      'https://tale.example.com/assets/abs.js',
    ]);
  });
});
