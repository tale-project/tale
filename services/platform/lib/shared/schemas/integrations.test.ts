import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { integrationJsonSchema, isDuplicableIntegration } from './integrations';

/**
 * Every integration `config.json` in `builtin-configs/integrations/` ships as
 * part of the product — new orgs seed their integration catalog by copying
 * these files. Pin the schema here so an example drifting into an invalid
 * shape is caught loudly in CI rather than shipped.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const INTEGRATIONS_DIR = path.join(REPO_ROOT, 'builtin-configs/integrations');

/** Directories holding an integration (those with a `config.json`). */
function integrationSlugs(): string[] {
  return readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('builtin-configs/integrations/*/config.json invariants', () => {
  const slugs = integrationSlugs();

  it('discovered at least one default integration', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  for (const slug of slugs) {
    describe(slug, () => {
      const parsed = integrationJsonSchema.safeParse(
        readJson(path.join(INTEGRATIONS_DIR, slug, 'config.json')),
      );

      it('parses against integrationJsonSchema', () => {
        if (!parsed.success) {
          throw new Error(
            `${slug}/config.json failed schema: ${parsed.error.message}`,
          );
        }
        expect(parsed.success).toBe(true);
      });

      it('has a concise one-line description', () => {
        if (!parsed.success) throw new Error('schema parse failed');
        // The catalog renders the description as a single action line; a
        // newline breaks that layout (the icon convention is enforced by the
        // 24x24 white tile, but description shape lives here).
        const description = parsed.data.description;
        if (description !== undefined) {
          expect(description).not.toContain('\n');
          expect(description.trim().length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe('isDuplicableIntegration', () => {
  it('allows non-OAuth, type/capability-driven integrations', () => {
    expect(
      isDuplicableIntegration({ slug: 'imap_smtp', authMethod: 'basic_auth' }),
    ).toBe(true);
    expect(
      isDuplicableIntegration({ slug: 'tavily', authMethod: 'api_key' }),
    ).toBe(true);
    expect(
      isDuplicableIntegration({ slug: 'discord', authMethod: 'bearer_token' }),
    ).toBe(true);
  });

  it('blocks OAuth integrations (gmail / outlook / slack) — slug-bound registration', () => {
    for (const slug of ['gmail', 'outlook', 'slack']) {
      expect(isDuplicableIntegration({ slug, authMethod: 'oauth2' })).toBe(
        false,
      );
    }
  });

  it('blocks github even though it is bearer_token (sandbox git auth keys on the slug)', () => {
    expect(
      isDuplicableIntegration({ slug: 'github', authMethod: 'bearer_token' }),
    ).toBe(false);
  });
});
