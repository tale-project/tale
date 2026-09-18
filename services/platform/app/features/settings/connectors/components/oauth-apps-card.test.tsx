import { describe, expect, it } from 'vitest';

import { hasDeploymentApp } from './oauth-apps-card';

/**
 * The card's status column answers one question per row: is there an app
 * underneath when the org has no row of its own? Every row but Google Drive
 * gets that from the catalog summary. Google Drive's row stands for two
 * lanes — the connector and Knowledge's import — whose deployment variables
 * are spelled differently, so the row has to consult both.
 */
describe('hasDeploymentApp', () => {
  it('reports a deployment app for any connector whose catalog summary says env', () => {
    expect(hasDeploymentApp('outlook', 'env', null)).toBe(true);
  });

  it('reports none when the summary says the app is the org row', () => {
    expect(hasDeploymentApp('outlook', 'org', null)).toBe(false);
  });

  it('reports none when nothing answers', () => {
    expect(hasDeploymentApp('outlook', null, null)).toBe(false);
    expect(hasDeploymentApp('outlook', undefined, undefined)).toBe(false);
  });

  it('reports a deployment app for Google Drive when only the IMPORT lane is set', () => {
    // CLOUD_IMPORT_GOOGLE_DRIVE_* set, CONNECTOR_OAUTH_GOOGLE_DRIVE_* not:
    // Drive import works, so the row must not read "Not configured".
    expect(hasDeploymentApp('google-drive', null, 'env')).toBe(true);
  });

  it('reports a deployment app for Google Drive when only the CONNECTOR lane is set', () => {
    expect(hasDeploymentApp('google-drive', 'env', null)).toBe(true);
  });

  it('does not let the Drive import lane answer for another connector', () => {
    expect(hasDeploymentApp('outlook', null, 'env')).toBe(false);
    expect(hasDeploymentApp('gmail', null, 'env')).toBe(false);
  });

  it('reports none for Google Drive when neither lane is set', () => {
    expect(hasDeploymentApp('google-drive', null, null)).toBe(false);
    expect(hasDeploymentApp('google-drive', 'org', 'org')).toBe(false);
  });
});
