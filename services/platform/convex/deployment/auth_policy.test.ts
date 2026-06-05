import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decideInstanceAdmin } from './auth_policy';

const ENV = 'TALE_DEPLOYMENT_CONFIG_ADMINS';
const ADMIN = [{ organizationId: 'org1', role: 'owner' }];
const NON_ADMIN = [{ organizationId: 'org1', role: 'member' }];

describe('decideInstanceAdmin', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[ENV];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it('denies a caller who administers no org (read or write)', () => {
    for (const write of [false, true]) {
      const d = decideInstanceAdmin({
        email: 'a@x.io',
        members: NON_ADMIN,
        write,
      });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe('FORBIDDEN_INSTANCE_ADMIN');
    }
  });

  it('allows an admin to READ regardless of the editor allowlist', () => {
    delete process.env[ENV]; // empty allowlist = nobody may edit
    const d = decideInstanceAdmin({
      email: 'a@x.io',
      members: ADMIN,
      write: false,
    });
    expect(d.ok).toBe(true);
  });

  it('blocks a WRITE by an admin not in the editor allowlist', () => {
    process.env[ENV] = 'editor@x.io';
    const d = decideInstanceAdmin({
      email: 'other@x.io',
      members: ADMIN,
      write: true,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('FORBIDDEN_DEPLOYMENT_EDITOR');
  });

  it('allows a WRITE by an admin in the editor allowlist (case-insensitive)', () => {
    process.env[ENV] = 'Editor@X.io';
    const d = decideInstanceAdmin({
      email: 'editor@x.io',
      members: ADMIN,
      write: true,
    });
    expect(d.ok).toBe(true);
  });

  it('locks ALL writes when the allowlist is empty', () => {
    delete process.env[ENV];
    const d = decideInstanceAdmin({
      email: 'a@x.io',
      members: ADMIN,
      write: true,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('FORBIDDEN_DEPLOYMENT_EDITOR');
  });
});
