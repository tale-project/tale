import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultGithubAppName,
  GITHUB_APP_NAME_MAX,
  githubAppInstallUrl,
  githubAppPageUrl,
  githubAppRegisterUrl,
  isGithubAppName,
  isGithubLogin,
} from './connector-github-app';

/**
 * The GitHub App hand-offs build the deployment's URLs, which the register
 * route reads back parameter by parameter; the checks mirror the route's
 * own, so a name it would refuse is refused before the browser leaves.
 */
describe('the GitHub App hand-off URLs', () => {
  beforeEach(() => {
    window.__ENV__ = { SITE_URL: 'https://tale.example', BASE_PATH: '/tale' };
  });
  afterEach(() => {
    delete window.__ENV__;
  });

  it('registers an app with every detail encoded and trimmed', () => {
    expect(
      githubAppRegisterUrl({
        organizationId: 'org-1',
        connectorSlug: 'github',
        credentialName: '  Release app ',
        appName: ' Tale Zürich & Co ',
        owner: ' acme-labs ',
      }),
    ).toBe(
      'https://tale.example/tale/api/connectors/github-app/register?organizationId=org-1&connectorSlug=github&credentialName=Release+app&appName=Tale+Z%C3%BCrich+%26+Co&owner=acme-labs',
    );
  });

  it('registers on the personal account when no organization is named', () => {
    const registration = {
      organizationId: 'org-1',
      connectorSlug: 'github',
      credentialName: 'GitHub',
      appName: 'Tale Acme',
    };
    const expected =
      'https://tale.example/tale/api/connectors/github-app/register?organizationId=org-1&connectorSlug=github&credentialName=GitHub&appName=Tale+Acme';
    expect(githubAppRegisterUrl(registration)).toBe(expected);
    expect(githubAppRegisterUrl({ ...registration, owner: '   ' })).toBe(
      expected,
    );
  });

  it('installs a credential by its ID', () => {
    expect(githubAppInstallUrl('org-1', 'cred 1/2')).toBe(
      'https://tale.example/tale/api/connectors/github-app/install?organizationId=org-1&credentialId=cred+1%2F2',
    );
  });

  it('links the app’s public page on GitHub', () => {
    expect(githubAppPageUrl('tale-acme')).toBe(
      'https://github.com/apps/tale-acme',
    );
    expect(githubAppPageUrl('a/b')).toBe('https://github.com/apps/a%2Fb');
  });
});

describe('defaultGithubAppName', () => {
  it('names the app after the organization', () => {
    expect(defaultGithubAppName('Acme')).toBe('Tale Acme');
  });

  it.each([undefined, '', ' \t\n'])(
    'falls back to "Tale" for the blank name %j',
    (organizationName) => {
      expect(defaultGithubAppName(organizationName)).toBe('Tale');
    },
  );

  it('folds whitespace and control characters into single spaces', () => {
    expect(defaultGithubAppName(' Acme\n\t Labs\u0007 GmbH ')).toBe(
      'Tale Acme Labs GmbH',
    );
  });

  it('cuts a long name to what GitHub takes, never ending in a space', () => {
    expect(defaultGithubAppName('A'.repeat(40))).toBe(`Tale ${'A'.repeat(29)}`);
    // The 34th character is the space before "yz".
    expect(defaultGithubAppName(`${'x'.repeat(28)} yz`)).toBe(
      `Tale ${'x'.repeat(28)}`,
    );
  });

  it('cuts between characters, never inside one', () => {
    const name = defaultGithubAppName('😀'.repeat(20));
    expect(name).toBe(`Tale ${'😀'.repeat(14)}`);
    expect(name.length).toBeLessThanOrEqual(GITHUB_APP_NAME_MAX);
    expect(isGithubAppName(name)).toBe(true);
  });
});

describe('isGithubAppName', () => {
  it.each([
    ['Tale Acme', true],
    [' Tale Acme ', true],
    ['a'.repeat(GITHUB_APP_NAME_MAX), true],
    // Counted in characters, as the register route counts.
    ['😀'.repeat(GITHUB_APP_NAME_MAX), true],
    ['a'.repeat(GITHUB_APP_NAME_MAX + 1), false],
    ['', false],
    ['   ', false],
    ['Tale\nAcme', false],
    ['Tale\u0007', false],
  ])('%j → %s', (value, expected) => {
    expect(isGithubAppName(value)).toBe(expected);
  });
});

describe('isGithubLogin', () => {
  it.each([
    ['acme', true],
    ['acme-labs', true],
    [' acme ', true],
    ['a'.repeat(39), true],
    ['a'.repeat(40), false],
    ['-acme', false],
    ['acme-', false],
    ['ac--me', false],
    ['acme_labs', false],
    ['acme.labs', false],
    ['', false],
  ])('%j → %s', (value, expected) => {
    expect(isGithubLogin(value)).toBe(expected);
  });
});
