/**
 * Parity gate for the three sibling email automation bundles
 * (`builtin-configs/automations/{reply-outlook-emails,reply-gmail-emails,reply-imap-emails}/`). The three
 * automations are ONE product per provider: their manifests must be identical modulo
 * the fields that name the provider (name, description, the inline `i18n`
 * block, requires.integrations, the provider chip in `labels`). A drift here
 * means a fix landed in one inbox and not its siblings. The inbox UI itself is
 * NOT bundled: each manifest opts into the platform-rendered builtin view
 * (`builtinViews: [{ id: 'inbox' }]`, rendered by
 * `automation/features/automations/builtin-views/`), so the bundles ship no `views/`
 * at all — pinned below. Display strings are the manifest's own literals +
 * inline `i18n` overrides (no per-bundle message catalog); schema/label
 * validity is owned by the generic builtin-automations gate
 * (`workflow_engine/helpers/validation/builtin_apps.test.ts`); this suite only
 * pins the three-way symmetry.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const AUTOMATIONS_DIR = fileURLToPath(
  new URL('../../../../builtin-configs/automations/', import.meta.url),
);

interface EmailBundle {
  slug: string;
  /** Integration slug baked into query args + requires.integrations. */
  integration: string;
  /** Display name (automation.json `name`) — excluded from parity. */
  name: string;
  /** Provider chip in `labels`, next to the shared "Email" — excluded from parity. */
  label: string;
}

const BUNDLES: EmailBundle[] = [
  {
    slug: 'reply-outlook-emails',
    integration: 'outlook',
    name: 'Reply to Outlook emails',
    label: 'Outlook',
  },
  {
    slug: 'reply-gmail-emails',
    integration: 'gmail',
    name: 'Reply to Gmail emails',
    label: 'Gmail',
  },
  {
    slug: 'reply-imap-emails',
    integration: 'imap_smtp',
    name: 'Reply to emails via SMTP/IMAP',
    label: 'IMAP',
  },
];

const [reference, ...siblings] = BUNDLES;

const readBundleFile = (bundle: EmailBundle, rel: string): string =>
  readFileSync(join(AUTOMATIONS_DIR, bundle.slug, rel), 'utf8');

describe('email inbox bundles are provider-substituted copies of one document', () => {
  it('ships NO bundled views — the inbox is the platform builtin view', () => {
    // The inbox UI lives in the platform codebase
    // (`automation/features/automations/builtin-views/inbox-view.tsx`); a `views/`
    // dir reappearing in a bundle would fork the UI back into data.
    for (const bundle of BUNDLES) {
      expect(
        existsSync(join(AUTOMATIONS_DIR, bundle.slug, 'views')),
        `${bundle.slug}/views`,
      ).toBe(false);
    }
  });

  it('every manifest opts into the platform inbox builtin view', () => {
    for (const bundle of BUNDLES) {
      const manifest = JSON.parse(
        readBundleFile(bundle, 'automation.json'),
      ) as {
        builtinViews?: unknown;
      };
      expect(manifest.builtinViews, `${bundle.slug} builtinViews`).toEqual([
        { id: 'inbox' },
      ]);
    }
  });

  it('automation.json manifests match modulo name/description/i18n/integration/label/workflow', () => {
    const neutralized = BUNDLES.map((bundle) => {
      const manifest = JSON.parse(
        readBundleFile(bundle, 'automation.json'),
      ) as Record<string, unknown>;
      return {
        ...manifest,
        name: '__NAME__',
        description: '__DESCRIPTION__',
        // The manifest translates ITSELF via an inline `i18n` block — every
        // entry (de/fr name + description) is provider copy, so the whole
        // block is provider identity, not shared structure.
        i18n: '__I18N__',
        requires: { integrations: ['__PROVIDER__'] },
        // The inline mail-sync workflow is provider-specific BY DESIGN (each
        // talks its own connector operations; IMAP also syncs the sent
        // folder), so parity covers only its PRESENCE — a provider shipping
        // without one diverges here — never its steps.
        workflow: manifest.workflow ? '__PROVIDER_WORKFLOW__' : '__MISSING__',
        // Only the provider chip is neutralized — the shared "Email" label (and
        // the shape of the list) stays pinned by the parity comparison.
        labels: Array.isArray(manifest.labels)
          ? manifest.labels.map((label) =>
              label === bundle.label ? '__PROVIDER_LABEL__' : label,
            )
          : manifest.labels,
      };
    });
    for (const [index, manifest] of neutralized.entries()) {
      if (index === 0) continue;
      expect(
        manifest,
        `automation.json of ${BUNDLES[index].slug} diverged from ${reference.slug}`,
      ).toEqual(neutralized[0]);
    }
  });

  it('each manifest carries ITS provider identity (the fields parity excludes)', () => {
    for (const bundle of BUNDLES) {
      const manifest = JSON.parse(
        readBundleFile(bundle, 'automation.json'),
      ) as {
        name?: string;
        labels?: string[];
        requires?: { integrations?: string[] };
        i18n?: Record<string, { name?: string; description?: string }>;
      };
      expect(manifest.name, `${bundle.slug} name`).toBe(bundle.name);
      expect(manifest.labels, `${bundle.slug} labels`).toEqual([
        'Email',
        bundle.label,
      ]);
      expect(
        manifest.requires?.integrations,
        `${bundle.slug} requires.integrations`,
      ).toEqual([bundle.integration]);
      // Each bundle carries its OWN de/fr name — never a shared literal that
      // would leak one provider's copy into another's catalog.
      expect(
        manifest.i18n?.de?.name,
        `${bundle.slug} i18n.de.name`,
      ).toBeTruthy();
      expect(
        manifest.i18n?.fr?.name,
        `${bundle.slug} i18n.fr.name`,
      ).toBeTruthy();
    }
  });

  it("each bundle ships its provider's brand icon (a non-empty icon.svg)", () => {
    for (const bundle of BUNDLES) {
      const iconPath = join(AUTOMATIONS_DIR, bundle.slug, 'icon.svg');
      expect(existsSync(iconPath), `${bundle.slug}/icon.svg`).toBe(true);
      expect(
        statSync(iconPath).size,
        `${bundle.slug}/icon.svg bytes`,
      ).toBeGreaterThan(0);
    }
  });

  it('the three bundles carry the exact same file set', () => {
    // A file added to one sibling only (e.g. a second view) would sail past
    // the per-file parity pins above — compare the full recursive listing.
    const fileSetOf = (bundle: EmailBundle): string[] => {
      const root = join(AUTOMATIONS_DIR, bundle.slug);
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(join(dir, entry.name))
            : [relative(root, join(dir, entry.name))],
        );
      return walk(root).sort();
    };
    const referenceFiles = fileSetOf(reference);
    for (const bundle of siblings) {
      expect(fileSetOf(bundle), `${bundle.slug} file set`).toEqual(
        referenceFiles,
      );
    }
  });
});
