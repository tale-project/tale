// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectOrgFrameAncestors,
  createOrgFrameAncestorsProvider,
} from './org-frame-ancestors';

/**
 * The frame-ancestor scan behind the SPA's CSP: the union of every enabled
 * `embedding` policy, YAML first then JSON, deduplicated and sorted, with
 * disabled, malformed and schema-refused files contributing nothing — and
 * never a value the header alphabet would not admit.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
  vi.restoreAllMocks();
});

function configDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'frame-ancestors-'));
  roots.push(root);
  return root;
}

function writePolicy(root: string, org: string, file: string, body: string) {
  mkdirSync(join(root, org, 'governance'), { recursive: true });
  writeFileSync(join(root, org, 'governance', file), body);
}

describe('collectOrgFrameAncestors', () => {
  it('unions every enabled policy, deduplicated and sorted', () => {
    const root = configDir();
    writePolicy(
      root,
      'acme',
      'embedding.yml',
      'enabled: true\nframeAncestors:\n  - https://portal.example\n  - https://app.example\n',
    );
    writePolicy(
      root,
      'globex',
      'embedding.json',
      JSON.stringify({
        enabled: true,
        frameAncestors: ['https://app.example', 'http://localhost:5173'],
      }),
    );
    mkdirSync(join(root, 'no-policy', 'governance'), { recursive: true });

    expect(collectOrgFrameAncestors(root)).toEqual([
      'http://localhost:5173',
      'https://app.example',
      'https://portal.example',
    ]);
  });

  it('contributes nothing from a disabled policy', () => {
    const root = configDir();
    writePolicy(
      root,
      'acme',
      'embedding.yml',
      'enabled: false\nframeAncestors:\n  - https://portal.example\n',
    );

    expect(collectOrgFrameAncestors(root)).toEqual([]);
  });

  it('skips a malformed or schema-refused file with a warning, never a header value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = configDir();
    writePolicy(root, 'broken', 'embedding.yml', 'enabled: [\n');
    writePolicy(
      root,
      'hostile',
      'embedding.yml',
      'enabled: true\nframeAncestors:\n  - "https://a.example; script-src *"\n',
    );
    writePolicy(
      root,
      'plain-http',
      'embedding.yml',
      'enabled: true\nframeAncestors:\n  - http://portal.example\n',
    );
    writePolicy(
      root,
      'fine',
      'embedding.yml',
      'enabled: true\nframeAncestors:\n  - https://fine.example\n',
    );

    expect(collectOrgFrameAncestors(root)).toEqual(['https://fine.example']);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('prefers the YAML file over a JSON sibling', () => {
    const root = configDir();
    writePolicy(
      root,
      'acme',
      'embedding.yml',
      'enabled: true\nframeAncestors:\n  - https://yaml.example\n',
    );
    writePolicy(
      root,
      'acme',
      'embedding.json',
      JSON.stringify({
        enabled: true,
        frameAncestors: ['https://json.example'],
      }),
    );

    expect(collectOrgFrameAncestors(root)).toEqual(['https://yaml.example']);
  });

  it('answers nothing for an unreadable config dir', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(collectOrgFrameAncestors('/nonexistent/config/dir')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('createOrgFrameAncestorsProvider', () => {
  it('is a no-op without a config dir', () => {
    expect(createOrgFrameAncestorsProvider(null)()).toEqual([]);
    expect(createOrgFrameAncestorsProvider(undefined)()).toEqual([]);
  });

  it('caches within the TTL and rescans after it', () => {
    const root = configDir();
    const provider = createOrgFrameAncestorsProvider(root, 1000);
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(10_000);
    expect(provider()).toEqual([]);

    writePolicy(
      root,
      'acme',
      'embedding.yml',
      'enabled: true\nframeAncestors:\n  - https://portal.example\n',
    );
    now.mockReturnValue(10_500);
    expect(provider()).toEqual([]);
    now.mockReturnValue(11_000);
    expect(provider()).toEqual(['https://portal.example']);
  });
});
