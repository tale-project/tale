import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverOrgs, isDeployableOrgSlug, ORGS_SUBDIR } from './org-dirs';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tale-orgdirs-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeDirs(...paths: string[]): void {
  for (const p of paths) mkdirSync(join(root, p), { recursive: true });
}

describe('isDeployableOrgSlug', () => {
  test('rejects the default template', () => {
    expect(isDeployableOrgSlug('default')).toBe(false);
  });
  test('accepts well-formed slugs', () => {
    expect(isDeployableOrgSlug('acme')).toBe(true);
    expect(isDeployableOrgSlug('my-org_2')).toBe(true);
  });
  test('rejects malformed slugs', () => {
    expect(isDeployableOrgSlug('Acme')).toBe(false);
    expect(isDeployableOrgSlug('-leading')).toBe(false);
  });
});

describe('discoverOrgs', () => {
  test('discovers real orgs under .tale/orgs, excludes default and root dirs', () => {
    makeDirs(
      'default/agents',
      join(ORGS_SUBDIR, 'acme', 'agents'),
      join(ORGS_SUBDIR, 'beta', 'providers'),
    );
    const result = discoverOrgs(root);
    expect(result.orgs.map((o) => o.slug).sort()).toEqual(['acme', 'beta']);
    expect(result.staleRootOrgDirs).toEqual([]);
    const acme = result.orgs.find((o) => o.slug === 'acme');
    expect(acme?.srcDir).toContain(join(ORGS_SUBDIR, 'acme'));
  });

  test('never treats default as a deployable org', () => {
    makeDirs('default/agents', join(ORGS_SUBDIR, 'default', 'agents'));
    const result = discoverOrgs(root);
    expect(result.orgs.map((o) => o.slug)).not.toContain('default');
  });

  test('treats org-shaped root dirs as stale, not deployable', () => {
    makeDirs('agents', 'workflows', join(ORGS_SUBDIR, 'acme', 'agents'));
    const result = discoverOrgs(root);
    expect(result.staleRootOrgDirs.sort()).toEqual(['agents', 'workflows']);
    expect(result.orgs.map((o) => o.slug)).toEqual(['acme']);
  });

  test('flags stale per-org-at-root dirs (pre-.tale/orgs layout)', () => {
    makeDirs('default/agents', 'acme/agents');
    const result = discoverOrgs(root);
    expect(result.staleRootOrgDirs).toEqual(['acme']);
    expect(result.orgs).toEqual([]);
  });

  test('empty / no .tale/orgs → no orgs, no errors', () => {
    makeDirs('default/agents');
    const result = discoverOrgs(root);
    expect(result.orgs).toEqual([]);
    expect(result.staleRootOrgDirs).toEqual([]);
  });
});
