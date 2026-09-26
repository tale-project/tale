import { describe, expect, it } from 'vitest';

import {
  findManifestDefects,
  parsePrecacheManifest,
} from './check-sw-manifest.ts';

const SW = `define(["./workbox-abc.js"],function(e){"use strict";e.precacheAndRoute([{url:"favicon.ico",revision:"9c1a"},{revision:"3f2e",url:"offline.html"},{url:"assets/pwa-192x192.png",revision:null},{url:"assets/pwa-192x192.png",revision:"025e"},{url:"assets/index-BQ4kL2mZ.js",revision:null}],{})});`;

describe('parsePrecacheManifest', () => {
  it('reads every entry of a minified generateSW manifest, whichever key comes first', () => {
    expect(parsePrecacheManifest(SW)).toEqual([
      { url: 'favicon.ico', revision: '9c1a' },
      { url: 'offline.html', revision: '3f2e' },
      { url: 'assets/pwa-192x192.png', revision: null },
      { url: 'assets/pwa-192x192.png', revision: '025e' },
      { url: 'assets/index-BQ4kL2mZ.js', revision: null },
    ]);
  });

  it('refuses a worker without a precache call', () => {
    expect(() => parsePrecacheManifest('self.addEventListener()')).toThrow(
      /precacheAndRoute/,
    );
  });
});

describe('findManifestDefects', () => {
  it('names a URL listed twice and an un-revisioned public asset, and accepts a hashed bundle', () => {
    expect(findManifestDefects(parsePrecacheManifest(SW))).toEqual([
      'assets/pwa-192x192.png is listed 2 times',
      'assets/pwa-192x192.png has no revision',
    ]);
  });

  it('answers nothing for a sound manifest', () => {
    expect(
      findManifestDefects([
        { url: 'offline.html', revision: '1' },
        { url: 'favicon.ico', revision: '2' },
        { url: 'assets/pwa-192x192.png', revision: '3' },
        { url: 'manifest.webmanifest', revision: '4' },
      ]),
    ).toEqual([]);
  });

  it('insists on the offline shell', () => {
    expect(
      findManifestDefects([{ url: 'favicon.ico', revision: '2' }]),
    ).toEqual(['offline.html is not precached']);
  });
});
