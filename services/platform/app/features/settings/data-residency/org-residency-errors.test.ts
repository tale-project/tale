import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { mapOrgResidencyError } from './org-residency-errors';

// Identity translator: the assertion names the message key that was chosen.
const t = (key: string) => key;

describe('mapOrgResidencyError', () => {
  // The adapted lane's refusals arrive as `AppError({ code, message })`. A
  // lapsed session is the session door's 401 `UNAUTHORIZED`; the mapper
  // waited for the Convex-era `UNAUTHENTICATED`, so the admin was shown the
  // door's English sentence instead of the translated notice.
  it("maps the session door's 401 to the forbidden notice", () => {
    expect(
      mapOrgResidencyError(
        new AppError({
          code: 'UNAUTHORIZED',
          message:
            'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
        }),
        t,
      ),
    ).toBe('dataResidency.orgStorage.errors.forbidden');
  });

  it.each(['ORG_ID_REQUIRED', 'ORG_NOT_FOUND', 'ORG_FORBIDDEN'])(
    'maps %s to the forbidden notice',
    (code) => {
      expect(
        mapOrgResidencyError(
          new AppError({ code, message: 'Not a member of this organization' }),
          t,
        ),
      ).toBe('dataResidency.orgStorage.errors.forbidden');
    },
  );

  it("shows the server's sentence for a code it does not map", () => {
    expect(
      mapOrgResidencyError(
        new AppError({ code: 'SOMETHING_ELSE', message: 'The bucket is gone' }),
        t,
      ),
    ).toBe('The bucket is gone');
  });
});
