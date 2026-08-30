import { describe, expect, it } from 'vitest';

import {
  isOpaqueServerErrorMessage,
  mapCredentialError,
} from './map-credential-error';

describe('isOpaqueServerErrorMessage', () => {
  it('flags Convex action dumps', () => {
    expect(
      isOpaqueServerErrorMessage(
        "[CONVEX A(lib/providers/catalog_actions:listProviderCatalogs)] [Request ID: abc] Server Error Cannot find module '/var/folders/x/T/tmp/modules/lib/providers/catalog_actions.js' Called by client",
      ),
    ).toBe(true);
  });

  it('allows short product sentences', () => {
    expect(isOpaqueServerErrorMessage('catalog root missing')).toBe(false);
  });
});

describe('mapCredentialError', () => {
  it('returns structured BackendError messages', () => {
    expect(
      mapCredentialError({ data: { message: 'Name already taken' } }),
    ).toBe('Name already taken');
  });

  it('replaces opaque Error.message dumps with a reload hint', () => {
    expect(
      mapCredentialError(
        new Error(
          "[CONVEX A(lib/providers/harness_status:listHarnessStatus)] [Request ID: d508] Server Error Cannot find module '/var/folders/r5/tmp/modules/lib/providers/harness_status.js' Called by client",
        ),
      ),
    ).toBe('Something went wrong. Reload and try again.');
  });
});
