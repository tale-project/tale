// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { scimResponseForAppError } from './routes.ts';

/** The provisioning layer's coded refusals and their RFC 7644 answers. */
describe('scimResponseForAppError', () => {
  it.each([
    ['scim_user_conflict', 409, 'uniqueness'],
    ['scim_owner_protected', 403, 'mutability'],
    ['scim_identity_shared', 403, 'mutability'],
    ['scim_invalid_member', 400, 'invalidValue'],
  ])(
    'maps %s to %i %s, carrying the detail',
    async (code, status, scimType) => {
      const res = scimResponseForAppError(
        new AppError({ code, message: 'why' }),
      );

      expect(res?.status).toBe(status);
      expect(res?.headers.get('content-type')).toBe('application/scim+json');
      expect(await res?.json()).toMatchObject({
        scimType,
        detail: 'why',
        status: String(status),
      });
    },
  );

  it('leaves every other error to the logged 500 path', () => {
    expect(scimResponseForAppError(new Error('boom'))).toBeNull();
    expect(
      scimResponseForAppError(new AppError({ code: 'not_a_scim_refusal' })),
    ).toBeNull();
    expect(scimResponseForAppError(new AppError('plain string'))).toBeNull();
  });
});
