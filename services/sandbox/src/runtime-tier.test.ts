import { describe, expect, test } from 'bun:test';

import {
  dindCapabilityOf,
  dindDefaultEnabled,
  dindExperimental,
  dindIsPrivileged,
  dockerRuntimeFor,
  isRuntimeTier,
  k8sRuntimeClassFor,
  RUNTIME_TIERS,
} from './runtime-tier.ts';

describe('runtime-tier', () => {
  test('RUNTIME_TIERS is the full closed set', () => {
    expect([...RUNTIME_TIERS].sort()).toEqual([
      'gvisor',
      'kata',
      'runc',
      'sysbox',
    ]);
  });

  test('isRuntimeTier accepts known tiers, rejects others', () => {
    for (const t of RUNTIME_TIERS) expect(isRuntimeTier(t)).toBe(true);
    expect(isRuntimeTier('runsc')).toBe(false); // alias resolved in config, not here
    expect(isRuntimeTier('nope')).toBe(false);
    expect(isRuntimeTier('')).toBe(false);
  });

  test('docker --runtime value per tier', () => {
    expect(dockerRuntimeFor('runc')).toBe('runc');
    expect(dockerRuntimeFor('gvisor')).toBe('runsc');
    expect(dockerRuntimeFor('sysbox')).toBe('sysbox-runc');
    expect(dockerRuntimeFor('kata')).toBe('kata');
  });

  test('k8s runtimeClassName per tier (runc omits)', () => {
    expect(k8sRuntimeClassFor('runc')).toBeNull();
    expect(k8sRuntimeClassFor('gvisor')).toBe('gvisor');
    expect(k8sRuntimeClassFor('sysbox')).toBe('sysbox-runc');
    expect(k8sRuntimeClassFor('kata')).toBe('kata');
  });

  test('dind capability per tier', () => {
    expect(dindCapabilityOf('runc')).toBe('privileged');
    expect(dindCapabilityOf('gvisor')).toBe('native');
    expect(dindCapabilityOf('sysbox')).toBe('native');
    expect(dindCapabilityOf('kata')).toBe('vm');
  });

  test('dindIsPrivileged: runc only (no boundary)', () => {
    expect(dindIsPrivileged('runc')).toBe(true);
    expect(dindIsPrivileged('sysbox')).toBe(false);
    expect(dindIsPrivileged('kata')).toBe(false);
    expect(dindIsPrivileged('gvisor')).toBe(false);
  });

  test('dindExperimental: gvisor only (functional, not security)', () => {
    expect(dindExperimental('gvisor')).toBe(true);
    expect(dindExperimental('runc')).toBe(false);
    expect(dindExperimental('sysbox')).toBe(false);
    expect(dindExperimental('kata')).toBe(false);
  });

  test('dindDefaultEnabled: on for boundary-keeping tiers only', () => {
    expect(dindDefaultEnabled('sysbox')).toBe(true);
    expect(dindDefaultEnabled('kata')).toBe(true);
    expect(dindDefaultEnabled('runc')).toBe(false);
    expect(dindDefaultEnabled('gvisor')).toBe(false);
  });

  test('the sysbox row resolves through the accessors', () => {
    expect(dockerRuntimeFor('sysbox')).toBe('sysbox-runc');
    expect(k8sRuntimeClassFor('sysbox')).toBe('sysbox-runc');
    expect(dindCapabilityOf('sysbox')).toBe('native');
  });
});
