import { describe, expect, it } from 'vitest';

import { httpStatusForConvexCode } from './helpers';

/**
 * The REST wrapper (`withRestAuth`) maps typed `ConvexError` codes to HTTP
 * statuses via `httpStatusForConvexCode`; any code resolving to a 4xx is
 * forwarded to the client, everything else falls through to a generic 500.
 *
 * `validateProductFields` throws `ConvexError({ code: 'too_long' })` on the
 * REST product write paths (`POST`/`PATCH /api/v1/products`), so `too_long`
 * must map to 400 — otherwise an over-length client input surfaces as a 500
 * (server error) instead of a 400 (client error).
 */
describe('httpStatusForConvexCode', () => {
  it('maps over-length input (too_long) to 400, not 500', () => {
    expect(httpStatusForConvexCode('too_long')).toBe(400);
  });

  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['validation', 400],
  ])('maps %s to %i', (code, status) => {
    expect(httpStatusForConvexCode(code)).toBe(status);
  });

  it.each([[undefined], ['something_unrecognized']])(
    'falls through to 500 for unrecognized code %s',
    (code) => {
      expect(httpStatusForConvexCode(code)).toBe(500);
    },
  );
});
