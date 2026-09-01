import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDeploymentEditor, parseDeploymentEditors } from './editors';

const ENV = 'TALE_DEPLOYMENT_CONFIG_ADMINS';

describe('deployment editor allowlist', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  function setEnv(value: string | undefined): void {
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
  }

  describe('parseDeploymentEditors', () => {
    it('returns an empty set when unset or blank (fail-safe)', () => {
      setEnv(undefined);
      expect(parseDeploymentEditors().size).toBe(0);
      setEnv('   ');
      expect(parseDeploymentEditors().size).toBe(0);
    });

    it('splits on commas, semicolons, and whitespace', () => {
      setEnv('a@x.com, b@x.com;c@x.com\td@x.com');
      expect([...parseDeploymentEditors()].sort()).toEqual([
        'a@x.com',
        'b@x.com',
        'c@x.com',
        'd@x.com',
      ]);
    });

    it('trims and lower-cases each entry', () => {
      setEnv('  Alice@Example.COM ,  BOB@x.com ');
      expect([...parseDeploymentEditors()].sort()).toEqual([
        'alice@example.com',
        'bob@x.com',
      ]);
    });

    it('drops empty fragments from stray separators', () => {
      setEnv(',, a@x.com ,;; ,');
      expect([...parseDeploymentEditors()]).toEqual(['a@x.com']);
    });
  });

  describe('isDeploymentEditor', () => {
    it('is false for a missing email', () => {
      setEnv('a@x.com');
      expect(isDeploymentEditor(undefined)).toBe(false);
      expect(isDeploymentEditor('')).toBe(false);
    });

    it('is false when the allowlist is empty', () => {
      setEnv(undefined);
      expect(isDeploymentEditor('a@x.com')).toBe(false);
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
      setEnv('alice@example.com,bob@x.com');
      expect(isDeploymentEditor('ALICE@example.com')).toBe(true);
      expect(isDeploymentEditor('  bob@x.com  ')).toBe(true);
      expect(isDeploymentEditor('carol@x.com')).toBe(false);
    });
  });
});
