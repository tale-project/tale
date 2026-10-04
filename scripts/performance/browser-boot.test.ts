import { expect, test } from 'bun:test';

import { verifyBoot, type BootEvidence } from './browser/boot';
import { browserOrigins } from './browser/origins.mjs';

test("fresh cold boot requires injected origin and this arm's actual entry bytes", () => {
  const origin = browserOrigins[0]!;
  const url = `${origin}/assets/index-owned.js`;
  const sha256 = 'a'.repeat(64);
  const assets = { 'assets/index-owned.js': sha256 };
  const evidence: BootEvidence = {
    origin,
    siteUrl: origin,
    figmaScripts: [],
    modules: [url],
    entries: [{ url, sha256 }],
  };
  expect(() => verifyBoot(evidence, origin, assets)).not.toThrow();
  for (const change of [
    { origin: browserOrigins[1] },
    { siteUrl: undefined },
    { siteUrl: browserOrigins[1] },
    { figmaScripts: ['https://mcp.figma.com/mcp/html-to-design/capture.js'] },
    { modules: [] },
    { entries: [] },
    { entries: [{ url, sha256: 'b'.repeat(64) }] },
    { modules: [`${url}?other`], entries: [{ url: `${url}?other`, sha256 }] },
    {
      modules: [`${browserOrigins[1]}/assets/index-owned.js`],
      entries: [{ url: `${browserOrigins[1]}/assets/index-owned.js`, sha256 }],
    },
  ]) {
    expect(() =>
      verifyBoot({ ...evidence, ...change }, origin, assets),
    ).toThrow();
  }
  expect(() => verifyBoot(evidence, origin, {})).toThrow('absent');
});
