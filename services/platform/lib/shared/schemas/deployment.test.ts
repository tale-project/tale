import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_CONFIG_VERSION,
  RETIRED_DEPLOYMENT_SECTIONS,
  deploymentConfigSchema,
} from './deployment';

describe('deploymentConfigSchema', () => {
  it('accepts a minimal config (version only — every section falls back to .env)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: DEPLOYMENT_CONFIG_VERSION,
    });
    expect(r.success).toBe(true);
  });

  it('accepts the sandboxRuntime section', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      sandboxRuntime: { tier: 'sysbox', dockerInContainer: true },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown top-level key (strict)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      bogus: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects the retired dataStores section — nothing reads it, so nothing may save it', () => {
    expect(RETIRED_DEPLOYMENT_SECTIONS).toContain('dataStores');
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      dataStores: {
        knowledgePostgres: { host: 'x', database: 'y', user: 'z' },
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown sandboxRuntime key (strict — protects against typos)', () => {
    const r = deploymentConfigSchema.safeParse({
      version: 1,
      sandboxRuntime: { teir: 'kata' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a wrong version', () => {
    const r = deploymentConfigSchema.safeParse({ version: 2 });
    expect(r.success).toBe(false);
  });
});
