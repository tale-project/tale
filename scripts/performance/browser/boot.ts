import assert from 'node:assert/strict';

export interface BootEvidence {
  origin: string;
  siteUrl: unknown;
  figmaScripts: string[];
  modules: string[];
  entries: { url: string; sha256: string }[];
}

/** Validate bytes already loaded by the cold page; never fetch a warm-up asset. */
export function verifyBoot(
  evidence: BootEvidence,
  origin: string,
  assets: Record<string, string>,
) {
  assert.equal(evidence.origin, origin, 'Cold page changed origin');
  assert.equal(
    evidence.siteUrl,
    origin,
    'Production runtime SITE_URL was not injected',
  );
  assert.deepEqual(
    evidence.figmaScripts,
    [],
    'Development Figma script was inserted',
  );
  assert(evidence.modules.length > 0, 'Cold page has no module entry');
  assert.deepEqual(
    evidence.entries.map((entry) => entry.url),
    evidence.modules,
    'Cold entry response evidence is incomplete',
  );
  for (const entry of evidence.entries) {
    const url = new URL(entry.url);
    assert.equal(url.origin, origin, 'Cold entry came from another origin');
    assert(!url.search && !url.hash, 'Unexpected entry URL suffix');
    const expected = assets[url.pathname.slice(1)];
    assert(expected, 'Cold entry is absent from this source arm build');
    assert.equal(
      entry.sha256,
      expected,
      'Served entry bytes differ from this source arm build',
    );
  }
}
