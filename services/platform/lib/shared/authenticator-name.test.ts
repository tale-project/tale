import { describe, expect, it } from 'vitest';

import {
  authenticatorName,
  totpClientNameSchema,
  totpEnvironmentSchema,
} from './authenticator-name';

describe('authenticatorName', () => {
  it.each([
    [undefined, undefined, 'Tale Platform', 'tale-platform'],
    [undefined, 'pr', 'Tale Platform', 'tale-platform'],
    [undefined, 'te', 'Tale Platform TE', 'tale-platform-te'],
    ['Tale', 'te', 'Tale Platform TE', 'tale-platform-te'],
    ['tale platform', undefined, 'Tale Platform', 'tale-platform'],
    ['Taler', 'pr', 'Taler Tale Platform', 'taler-tale-platform'],
    ['Acme', undefined, 'Acme Tale Platform', 'acme-tale-platform'],
    ['Acme', ' PR ', 'Acme Tale Platform', 'acme-tale-platform'],
    ['Acme', 'te', 'Acme Tale Platform TE', 'acme-tale-platform-te'],
    [
      'Example plus',
      'preview-42',
      'Example plus Tale Platform PREVIEW-42',
      'exampleplus-tale-platform-preview-42',
    ],
    [
      '  Zürich   & Weiß  ',
      'dv',
      'Zürich & Weiß Tale Platform DV',
      'zurichweiss-tale-platform-dv',
    ],
    ['東京', 'te', '東京 Tale Platform TE', 'tale-platform-te'],
  ])(
    'names client %j in environment %j as %j (%s)',
    (clientName, environment, issuer, fileSlug) => {
      expect(authenticatorName({ clientName, environment })).toEqual({
        issuer,
        fileSlug,
      });
    },
  );

  it.each(['', ' ', 'Acme: Admin', '-Acme', 'Acme/Partner', 'a'.repeat(41)])(
    'refuses the client name %j',
    (clientName) => {
      expect(() => authenticatorName({ clientName })).toThrow(
        /TOTP_CLIENT_NAME/,
      );
    },
  );

  it.each(['', ' ', '<TE>', 'te:issuer', 'te/pr', 'a'.repeat(33)])(
    'refuses the environment %j',
    (environment) => {
      expect(() => authenticatorName({ environment })).toThrow(
        /TOTP_ENVIRONMENT/,
      );
    },
  );

  it('normalizes the deployment values it accepts', () => {
    expect(totpClientNameSchema.parse(' Example \t plus ')).toBe(
      'Example plus',
    );
    expect(totpEnvironmentSchema.parse(' te ')).toBe('TE');
    expect(totpClientNameSchema.parse(undefined)).toBeUndefined();
    expect(totpEnvironmentSchema.parse(undefined)).toBeUndefined();
  });
});
