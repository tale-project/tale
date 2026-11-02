import { describe, expect, it } from 'vitest';

import { listConnectorSummaries } from './connector_catalog';

/**
 * The settings catalog tells the Connectors page what a GitHub App it is
 * about to register asks for: `githubAppPermissions`, from the connector's
 * `github-app` auth entry, on the connectors that offer the method and on
 * no other.
 */
describe('the settings catalog of the shipped connectors', () => {
  it('lists the repository permissions the GitHub connector asks of its app', () => {
    const github = listConnectorSummaries().find(
      (connector) => connector.slug === 'github',
    );
    expect(github?.authMethods).toEqual(['bearer', 'github-app']);
    expect(github?.githubAppPermissions).toEqual({
      metadata: 'read',
      contents: 'write',
      issues: 'write',
      pull_requests: 'write',
      security_events: 'read',
      vulnerability_alerts: 'read',
      secret_scanning_alerts: 'read',
    });
  });

  it('carries no app permissions on a connector without a GitHub App', () => {
    const others = listConnectorSummaries().filter(
      (connector) => !connector.authMethods.includes('github-app'),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const connector of others) {
      expect({
        slug: connector.slug,
        has: 'githubAppPermissions' in connector,
      }).toEqual({ slug: connector.slug, has: false });
    }
  });

  it('hands each listing its own copy of the permissions', () => {
    const first = listConnectorSummaries().find(
      (connector) => connector.slug === 'github',
    );
    if (first?.githubAppPermissions === undefined) {
      throw new Error('the GitHub connector lists no app permissions');
    }
    first.githubAppPermissions.administration = 'write';
    const again = listConnectorSummaries().find(
      (connector) => connector.slug === 'github',
    );
    expect(again?.githubAppPermissions).not.toHaveProperty('administration');
  });
});
