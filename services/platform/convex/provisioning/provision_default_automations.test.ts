// @vitest-environment node

/**
 * The seed batch, derived from the REAL shipped catalog: whatever lands in
 * `configs/platform/custom/automations/` must stay seedable — org-scope packs
 * only, every document carrying a store-valid name, at most one trigger each.
 * A pack this test refuses would silently vanish from every organization's
 * provisioning, so it fails loudly here instead.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertAutomationName } from '../automations/store';
import { loadSeedablePacks } from './provision_default_automations';

const REPO_CATALOG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../configs/platform/custom',
);

describe('loadSeedablePacks', () => {
  it('turns every shipped org-scope pack into a seedable batch', () => {
    const packs = loadSeedablePacks({ root: REPO_CATALOG });

    expect(packs).not.toBeNull();
    expect(packs ?? []).not.toHaveLength(0);
    for (const pack of packs ?? []) {
      // A name the store would refuse must never ship.
      expect(() =>
        assertAutomationName(pack.document.name ?? ''),
      ).not.toThrow();
      if (pack.trigger !== undefined) {
        expect(['schedule', 'webhook', 'event', 'api-key']).toContain(
          pack.trigger.kind,
        );
      }
    }
  });

  it('treats a root without an automations/ dir as an empty batch', () => {
    const packs = loadSeedablePacks({
      root: path.join(REPO_CATALOG, 'automations', 'gmail', 'triage-inbox'),
    });
    expect(packs).toEqual([]);
  });

  it('reports an unreadable catalog as null, not as an empty batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tale-packs-'));
    try {
      const packDir = path.join(root, 'automations', 'broken', 'pack');
      mkdirSync(packDir, { recursive: true });
      writeFileSync(path.join(packDir, 'automation.yml'), 'name: 1\n');
      expect(loadSeedablePacks({ root })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
