import { describe, expect, it } from 'vitest';

import type { AutomationManifest } from '../schemas/automations';
import { validateBundleShape } from './bundle_validation';

function manifest(
  overrides: Partial<AutomationManifest> = {},
): AutomationManifest {
  return { name: 'Test app', ...overrides };
}

describe('validateBundleShape', () => {
  it('passes a well-formed bundle: hidden members sharing the bundle scope', () => {
    const bundle = manifest({ bundle: { members: ['member-a', 'member-b'] } });
    const members = new Map<string, AutomationManifest | null>([
      ['member-a', manifest({ hidden: true })],
      ['member-b', manifest({ hidden: true, scope: 'org' })],
    ]);
    expect(validateBundleShape('demo-bundle', bundle, members)).toEqual([]);
  });

  it('reports NOT_A_BUNDLE when the manifest declares no bundle.members', () => {
    const errors = validateBundleShape('not-a-bundle', manifest(), new Map());
    expect(errors).toEqual([expect.objectContaining({ code: 'NOT_A_BUNDLE' })]);
  });

  it('reports HAS_INSTALL_FIELDS when the bundle itself declares workflows/agents/requires', () => {
    const bundle = manifest({
      bundle: { members: ['member-a'] },
      workflows: ['own-workflow'],
      requires: { integrations: ['github'] },
    });
    const members = new Map<string, AutomationManifest | null>([
      ['member-a', manifest({ hidden: true })],
    ]);
    const errors = validateBundleShape('demo-bundle', bundle, members);
    expect(errors).toEqual([
      expect.objectContaining({ code: 'HAS_INSTALL_FIELDS' }),
    ]);
  });

  it('reports MEMBER_MISSING for a declared member that does not resolve', () => {
    const bundle = manifest({ bundle: { members: ['ghost'] } });
    const errors = validateBundleShape(
      'demo-bundle',
      bundle,
      new Map([['ghost', null]]),
    );
    expect(errors).toEqual([
      expect.objectContaining({ code: 'MEMBER_MISSING' }),
    ]);
  });

  it('reports MEMBER_NOT_HIDDEN for a member missing hidden:true', () => {
    const bundle = manifest({ bundle: { members: ['visible-member'] } });
    const members = new Map<string, AutomationManifest | null>([
      ['visible-member', manifest()],
    ]);
    const errors = validateBundleShape('demo-bundle', bundle, members);
    expect(errors).toEqual([
      expect.objectContaining({ code: 'MEMBER_NOT_HIDDEN' }),
    ]);
  });

  it('reports SCOPE_MISMATCH when a member scope differs from the bundle scope', () => {
    const bundle = manifest({
      scope: 'org',
      bundle: { members: ['project-member'] },
    });
    const members = new Map<string, AutomationManifest | null>([
      ['project-member', manifest({ hidden: true, scope: 'project' })],
    ]);
    const errors = validateBundleShape('demo-bundle', bundle, members);
    expect(errors).toEqual([
      expect.objectContaining({ code: 'SCOPE_MISMATCH' }),
    ]);
  });

  it('collects every error across multiple members in one pass', () => {
    const bundle = manifest({
      scope: 'org',
      bundle: { members: ['ghost', 'visible', 'wrong-scope'] },
    });
    const members = new Map<string, AutomationManifest | null>([
      ['ghost', null],
      ['visible', manifest()],
      ['wrong-scope', manifest({ hidden: true, scope: 'project' })],
    ]);
    const errors = validateBundleShape('demo-bundle', bundle, members);
    expect(errors.map((e) => e.code)).toEqual([
      'MEMBER_MISSING',
      'MEMBER_NOT_HIDDEN',
      'SCOPE_MISMATCH',
    ]);
  });
});
