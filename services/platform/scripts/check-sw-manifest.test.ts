import { describe, expect, it } from 'vitest';

import {
  findManifestDefects,
  parsePrecacheManifest,
} from './check-sw-manifest.ts';

const INTEGRITY = `sha256-${'A'.repeat(43)}=`;
const SW = `define(["./workbox-abc.js"],function(e){"use strict";e.precacheAndRoute([{url:"favicon.ico",revision:"9c1a"},{revision:"3f2e",url:"offline.html?__tale_offline=1",integrity:"${INTEGRITY}"},{url:"pwa-recovery.js",revision:"5",integrity:"${INTEGRITY}"},{url:"pwa-build.json",revision:"6",integrity:"${INTEGRITY}"},{url:"assets/pwa-192x192.png",revision:null},{url:"assets/pwa-192x192.png",revision:"025e"},{url:"assets/index-BQ4kL2mZ.js",revision:null}],{})});`;

describe('parsePrecacheManifest', () => {
  it('reads every entry of a minified generateSW manifest, whichever key comes first', () => {
    expect(parsePrecacheManifest(SW)).toEqual([
      { url: 'favicon.ico', revision: '9c1a' },
      {
        url: 'offline.html?__tale_offline=1',
        revision: '3f2e',
        integrity: INTEGRITY,
      },
      { url: 'pwa-recovery.js', revision: '5', integrity: INTEGRITY },
      { url: 'pwa-build.json', revision: '6', integrity: INTEGRITY },
      { url: 'assets/pwa-192x192.png', revision: null },
      { url: 'assets/pwa-192x192.png', revision: '025e' },
      { url: 'assets/index-BQ4kL2mZ.js', revision: null },
    ]);
  });

  it('reads an inline runtime whose precache function was minified', () => {
    expect(
      parsePrecacheManifest(
        '(()=>{const n=(t)=>controller.precache(t);n([{url:"offline.html",revision:"1"},{url:"pwa-recovery.js",revision:"2"}]);})();',
      ),
    ).toEqual([
      { url: 'offline.html', revision: '1' },
      { url: 'pwa-recovery.js', revision: '2' },
    ]);
  });

  it('refuses ambiguous or partly unreadable manifests', () => {
    expect(() =>
      parsePrecacheManifest(
        'n([{url:"x",revision:"1"}]);n([{url:"y",revision:"2"}]);',
      ),
    ).toThrow(/one/);
    expect(() =>
      parsePrecacheManifest('n([{url:"x",revision:"1"},{url:"y"}]);'),
    ).toThrow(/unreadable/);
    expect(() =>
      parsePrecacheManifest('n([{url:"x",revision:"1",integrity:123}]);'),
    ).toThrow(/unreadable/);
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
        {
          url: 'offline.html?__tale_offline=1',
          revision: '1',
          integrity: INTEGRITY,
        },
        { url: 'favicon.ico', revision: '2' },
        { url: 'assets/pwa-192x192.png', revision: '3' },
        { url: 'manifest.webmanifest', revision: '4' },
        { url: 'pwa-recovery.js', revision: '5', integrity: INTEGRITY },
        { url: 'pwa-build.json', revision: '6', integrity: INTEGRITY },
      ]),
    ).toEqual([]);
  });

  it('insists on the offline shell', () => {
    expect(
      findManifestDefects([{ url: 'favicon.ico', revision: '2' }]),
    ).toEqual([
      'offline.html is not precached',
      'pwa-recovery.js is not precached',
      'pwa-build.json is not precached',
    ]);
  });

  it('refuses recovery files whose revisions do not verify their bytes', () => {
    expect(
      findManifestDefects([
        { url: 'offline.html?__tale_offline=1', revision: '1' },
        { url: 'pwa-recovery.js', revision: '2', integrity: 'sha256-wrong' },
        { url: 'pwa-build.json', revision: '3' },
      ]),
    ).toEqual([
      'offline.html has no SHA-256 integrity',
      'pwa-recovery.js has no SHA-256 integrity',
      'pwa-build.json has no SHA-256 integrity',
    ]);
  });

  it('keeps direct offline navigations on the strategy that scopes the recovery script', () => {
    const entries = parsePrecacheManifest(SW).filter(
      (entry) => !entry.url.startsWith('assets/'),
    );
    const offline = entries.find((entry) =>
      entry.url.startsWith('offline.html'),
    );
    if (offline) offline.url = 'offline.html';
    expect(findManifestDefects(entries)).toEqual([
      'offline.html must use the navigation fallback cache URL',
    ]);
  });
});
