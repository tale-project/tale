import { describe, expect, it, vi } from 'vitest';

import { parseDeploymentConfig, serializeDeploymentConfig } from './file_utils';

describe('parseDeploymentConfig', () => {
  it('reads the current YAML form and the retired JSON form alike', () => {
    expect(
      parseDeploymentConfig('version: 1\nsandboxRuntime:\n  tier: kata\n'),
    ).toEqual({
      version: 1,
      sandboxRuntime: { tier: 'kata' },
    });
    expect(
      parseDeploymentConfig(
        JSON.stringify({ version: 1, sandboxRuntime: { tier: 'runc' } }),
      ),
    ).toEqual({ version: 1, sandboxRuntime: { tier: 'runc' } });
  });

  it('drops the retired dataStores section with a warning instead of failing the read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const parsed = parseDeploymentConfig(
        JSON.stringify({
          version: 1,
          dataStores: {
            knowledgePostgres: {
              host: 'pg.acme.internal',
              database: 'k',
              user: 'u',
            },
            convexStorage: { mode: 'local' },
          },
          sandboxRuntime: { tier: 'sysbox', dockerInContainer: true },
        }),
      );
      expect(parsed).toEqual({
        version: 1,
        sandboxRuntime: { tier: 'sysbox', dockerInContainer: true },
      });
      expect('dataStores' in parsed).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('retired "dataStores" section');
      // The next save writes the file without the section.
      expect(serializeDeploymentConfig(parsed)).not.toContain('dataStores');
    } finally {
      warn.mockRestore();
    }
  });

  it('still fails closed on any other unknown key', () => {
    expect(() => parseDeploymentConfig('version: 1\nbogus: true\n')).toThrow(
      /Invalid deployment config/,
    );
  });

  it('fails closed on a wrong version and on unparseable content', () => {
    expect(() => parseDeploymentConfig('version: 2\n')).toThrow(
      /Invalid deployment config/,
    );
    expect(() => parseDeploymentConfig('{ not yaml')).toThrow();
  });
});
