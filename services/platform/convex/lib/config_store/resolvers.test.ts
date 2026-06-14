import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_DOMAINS } from '../../../lib/shared/config/registry';
import { DOMAIN_DIR_RESOLVERS, resolveDomainDir } from './resolvers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DOMAIN_DIR_RESOLVERS (registry Layer B)', () => {
  it('every registered config domain has a directory resolver (no drift)', () => {
    for (const d of CONFIG_DOMAINS) {
      expect(typeof DOMAIN_DIR_RESOLVERS[d.name]).toBe('function');
    }
  });

  it('resolveDomainDir throws for an unknown domain', () => {
    expect(() => resolveDomainDir('nope', 'default')).toThrow();
  });

  it('resolveDomainDir returns an org-first path under TALE_CONFIG_DIR', () => {
    vi.stubEnv('TALE_CONFIG_DIR', '/tmp/tale-cfg-test');
    const dir = resolveDomainDir('agents', 'acme');
    expect(dir).toContain('acme');
    expect(dir).toContain('agents');
  });
});
