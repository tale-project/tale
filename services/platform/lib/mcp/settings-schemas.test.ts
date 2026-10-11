// @vitest-environment node

import { FILE_POLICY_TYPES } from '@tale/shared/schemas/governance';
import { SETTINGS_KINDS } from '@tale/shared/schemas/settings-kinds';
import { describe, expect, it } from 'vitest';

import { secretMemberName } from '../shared/secret-scan';
import {
  declaredSettingsNames,
  settingsConfigSchema,
} from './settings-schemas';

/** A resource shape: its label and the member names its schema declares. */
type Shape = readonly [label: string, names: ReadonlySet<string>];

/** Every resource shape the settings tools read: each kind, and each
 * policy of `governance`. */
function shapes(): Shape[] {
  return SETTINGS_KINDS.flatMap((descriptor): Shape[] =>
    descriptor.kind === 'governance'
      ? FILE_POLICY_TYPES.map((policy): Shape => [
          `governance/${policy}`,
          declaredSettingsNames('governance', policy),
        ])
      : [[descriptor.kind, declaredSettingsNames(descriptor.kind, null)]],
  );
}

describe('the member names a setting declares', () => {
  it('are every field of the kind’s schema, and no key of a map it leaves open', () => {
    expect([...declaredSettingsNames('provider', null)]).toEqual(
      expect.arrayContaining(['name', 'baseUrl', 'auth', 'method']),
    );
    const moderation = declaredSettingsNames(
      'governance',
      'moderation_provider',
    );
    expect([...moderation]).toEqual(
      expect.arrayContaining(['endpoint', 'url', 'headers', 'requestTemplate']),
    );
    expect(moderation.has('Authorization')).toBe(false);
    expect(declaredSettingsNames('governance', 'no_such_policy').size).toBe(0);
    expect(settingsConfigSchema('governance', null)).toBeNull();
  });

  // A declared field is judged by its text alone, so a field whose name
  // reads as a secret must be one that only refers to a secret. A new such
  // field fails here until it is either listed as a reference or made a
  // secret path of its kind.
  it('read as a secret by name only where they refer to one', () => {
    const named = Object.fromEntries(
      shapes()
        .map(
          ([label, names]) =>
            [
              label,
              [...names]
                .filter((name) => secretMemberName(name) !== undefined)
                .sort(),
            ] as const,
        )
        .filter(([, names]) => names.length > 0),
    );
    expect(named).toEqual({
      // The ways a provider's credentials authenticate, not a credential.
      provider: ['auth'],
      // The credential an embedding model resolves, by id; and two rate
      // limits counted in tokens.
      'knowledge-embedding': [
        'credentialId',
        'maxTokensPerMinute',
        'minTokensPerSecond',
      ],
      // The API key a budget rule caps, by id.
      'governance/budgets': ['apiKeyId'],
    });
  });
});
