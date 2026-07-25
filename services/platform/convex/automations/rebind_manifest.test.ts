import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { rebindManifestIntegration } from './rebind_manifest';

/**
 * `rebindManifestIntegration` is the pure core of "Duplicate integration": it
 * rewrites an automation manifest's integration-slug references onto a new slug
 * and NOTHING else. Pin it against the real shipped imap sync-emails bundle so a
 * regression that over-rewrites (a template string, a display name) or
 * under-rewrites (misses a binding field) is caught loudly.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const IMAP_MANIFEST = path.join(
  REPO_ROOT,
  'builtin-configs/automations/imap-smtp/sync-emails/automation.json',
);

function loadImapManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(IMAP_MANIFEST, 'utf-8')) as Record<
    string,
    unknown
  >;
}

/** Count exact quoted JSON tokens (so `"imap_smtp"` never matches inside `"imap_smtp-2"`). */
function countToken(value: unknown, token: string): number {
  const re = new RegExp(`"${token.replace(/[-]/g, '\\$&')}"`, 'g');
  return (JSON.stringify(value).match(re) ?? []).length;
}

describe('rebindManifestIntegration', () => {
  it('rewrites exactly the 10 imap_smtp slug references to the new slug', () => {
    const source = loadImapManifest();
    const result = rebindManifestIntegration(
      source,
      'imap_smtp',
      'imap_smtp-2',
    );

    // The imap bundle names the integration in exactly 10 places.
    expect(countToken(result, 'imap_smtp-2')).toBe(10);
    // …and none of the original slug survives.
    expect(countToken(result, 'imap_smtp')).toBe(0);
  });

  it('rewrites each binding field by its exact role', () => {
    const result = rebindManifestIntegration(
      loadImapManifest(),
      'imap_smtp',
      'imap_smtp-2',
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test navigates known manifest shape
    const m = result as {
      requires: { integrations: string[] };
      workflow: {
        requires: { integrations: Array<{ name: string }> };
        steps: Array<{
          stepSlug: string;
          config?: { type?: string; parameters?: Record<string, unknown> };
        }>;
      };
    };

    // Manifest-level requires (drives requiredIntegrations + inbox channel).
    expect(m.requires.integrations).toEqual(['imap_smtp-2']);
    // Workflow-level requires ({name, operations}).
    expect(m.workflow.requires.integrations[0].name).toBe('imap_smtp-2');

    const byStep = new Map(m.workflow.steps.map((s) => [s.stepSlug, s]));
    // integration-type steps → parameters.name
    for (const slug of [
      'fetch_new_emails',
      'fetch_latest_emails',
      'fetch_new_sent_emails',
      'fetch_latest_sent_emails',
    ]) {
      expect(byStep.get(slug)?.config?.parameters?.name).toBe('imap_smtp-2');
    }
    // conversation-type steps → parameters.integrationName
    for (const slug of [
      'query_latest_inbound_message',
      'insert_emails_to_conversation',
      'query_latest_outbound_message',
      'insert_sent_emails_to_conversation',
    ]) {
      expect(byStep.get(slug)?.config?.parameters?.integrationName).toBe(
        'imap_smtp-2',
      );
    }
  });

  it('leaves display names, operations, and template strings untouched', () => {
    const source = loadImapManifest();
    const result = rebindManifestIntegration(
      source,
      'imap_smtp',
      'imap_smtp-2',
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test navigates known manifest shape
    const m = result as {
      name: string;
      workflow: {
        steps: Array<{
          name: string;
          config?: { parameters?: Record<string, unknown> };
        }>;
      };
    };

    // Manifest + step display names are unchanged.
    expect(m.name).toBe('Sync emails via SMTP/IMAP');
    const fetchNew = m.workflow.steps.find(
      (s) => s.name === 'Fetch New Emails (Incremental)',
    );
    expect(fetchNew).toBeDefined();
    // The `operation` and `{{steps…}}` template params on that step survive.
    expect(fetchNew?.config?.parameters?.operation).toBe('list_messages');
    const params = fetchNew?.config?.parameters as {
      params?: { since?: string };
    };
    expect(params.params?.since).toContain('{{steps.');
  });

  it('is a no-op when the source slug is not referenced', () => {
    const source = loadImapManifest();
    const result = rebindManifestIntegration(source, 'not_present', 'whatever');
    expect(result).toEqual(source);
  });

  it('does not mutate the input manifest', () => {
    const source = loadImapManifest();
    const snapshot = JSON.stringify(source);
    rebindManifestIntegration(source, 'imap_smtp', 'imap_smtp-2');
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
