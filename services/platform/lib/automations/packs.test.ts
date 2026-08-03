import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConnectors } from '../connectors/registry';
import { runAutomationTests } from '../engine/api/tests';
import { setCodeRunner } from '../engine/core/runner';
import { nodeTypes } from '../engine/core/slots';
import { templateExprsIn } from '../engine/core/template';
import type { Automation } from '../engine/core/types';
import { validate } from '../engine/core/validate';
import { nodeVmRunner } from '../engine/runners/node-vm';
import type { AutomationPack } from './packs';
import { automationPackManifestSchema, loadAutomationPacks } from './packs';

const REPO = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../..',
);

// Packs are read while the table below is built, so the engine is assembled
// at module scope — a pack that names an unregistered action must fail as a
// validation error, not as a missing-connector accident.
setCodeRunner(nodeVmRunner());
const { connectors } = loadConnectors(
  path.join(REPO, 'configs/platform/system'),
);
const packs = loadAutomationPacks({
  root: path.join(REPO, 'configs/platform/custom'),
});

const connectorNames = new Set(connectors.map((connector) => connector.name));

/** The connectors a document actually calls, from its node types. */
function connectorsUsedBy(automation: Automation): string[] {
  const used = new Set<string>();
  for (const node of automation.nodes) {
    if (!node.type.includes('.')) continue;
    used.add(node.type.slice(0, node.type.indexOf('.')));
  }
  return [...used].sort();
}

describe('the shipped automation packs', () => {
  it('are all discovered, each with a manifest, a document and an icon', () => {
    expect(packs.map((pack) => pack.slug)).toEqual([
      'github/review-pull-requests',
      'github/triage-issues',
      'gmail/sync-emails',
      'gmail/triage-inbox',
      'imap-smtp/sync-emails',
      'imap-smtp/triage-inbox',
      'outlook/sync-emails',
      'outlook/triage-inbox',
    ]);
  });

  for (const pack of packs) {
    describe(pack.slug, () => {
      it('validates clean', async () => {
        const { errors } = await validate(pack.automation);
        expect(errors).toEqual([]);
      });

      it('carries its own tests and they all pass against the mocks', async () => {
        const report = await runAutomationTests(pack.automation);
        expect(report).not.toHaveProperty('error');
        expect(report).toMatchObject({ failed: 0 });
        expect('passed' in report ? report.passed : 0).toBeGreaterThan(0);
      });

      it('declares every connector its document calls', () => {
        const declared = new Set(pack.manifest.requires?.connectors ?? []);
        for (const name of connectorsUsedBy(pack.automation)) {
          expect(declared.has(name)).toBe(true);
        }
        for (const name of declared) expect(connectorNames).toContain(name);
      });

      it('names every node type the engine knows', () => {
        for (const node of pack.automation.nodes) {
          expect(nodeTypes().has(node.type)).toBe(true);
        }
      });

      it('is addressed by its directory', () => {
        expect(pack.automation.name).toBe(pack.slug.replaceAll('/', '-'));
        expect(pack.manifest.name.length).toBeGreaterThan(0);
      });
    });
  }
});

// --------------------------------------------------- the provider trio rule

/**
 * The three inbox packs are one document with the connector substituted. What
 * may differ is the connector prefix, the fetch node's query dialect (compared
 * as the set of expressions it uses), the display text, and the values each
 * provider's mock produces inside the test expectations. Everything else —
 * node ids and order, control flow, transform code, prompts, the model, the
 * output mapping, the test names and inputs — must be identical, or the three
 * have silently become three automations.
 */
const EMAIL_PACKS = [
  { slug: 'gmail/triage-inbox', connector: 'gmail' },
  { slug: 'outlook/triage-inbox', connector: 'outlook' },
  { slug: 'imap-smtp/triage-inbox', connector: 'imap-smtp' },
] as const;

function packBySlug(slug: string): AutomationPack {
  const found = packs.find((pack) => pack.slug === slug);
  if (found === undefined) throw new Error(`no shipped pack "${slug}"`);
  return found;
}

function substituted(automation: Automation, connector: string): unknown {
  const prefix = `${connector}.`;
  return {
    version: automation.version,
    inputs: automation.inputs,
    output: automation.output,
    nodes: automation.nodes.map((node) =>
      node.type.startsWith(prefix)
        ? {
            ...node,
            type: `<provider>.${node.type.slice(prefix.length)}`,
            // The dialect differs by design; the values it is built from
            // must not.
            input: templateExprsIn(node.input).sort(),
          }
        : node,
    ),
    tests: (automation.tests ?? []).map((test) => ({
      name: test.name,
      input: test.input,
    })),
  };
}

describe('the three inbox packs stay one document', () => {
  const [canonical, ...variants] = EMAIL_PACKS;
  const expected = substituted(
    packBySlug(canonical.slug).automation,
    canonical.connector,
  );

  for (const variant of variants) {
    it(`${variant.slug} differs from ${canonical.slug} only by its connector`, () => {
      expect(
        substituted(packBySlug(variant.slug).automation, variant.connector),
      ).toEqual(expected);
    });
  }

  for (const variant of EMAIL_PACKS) {
    it(`${variant.slug} really calls ${variant.connector}`, () => {
      expect(connectorsUsedBy(packBySlug(variant.slug).automation)).toEqual([
        variant.connector,
      ]);
    });
  }

  it('keeps each variant honest about the provider in its display text', () => {
    for (const variant of EMAIL_PACKS) {
      const pack = packBySlug(variant.slug);
      expect(pack.automation.name).toContain(variant.connector);
      expect(pack.manifest.labels).toContain('Email');
    }
  });
});

const SYNC_EMAIL_PACKS = [
  { slug: 'gmail/sync-emails', connector: 'gmail' },
  { slug: 'outlook/sync-emails', connector: 'outlook' },
  { slug: 'imap-smtp/sync-emails', connector: 'imap-smtp' },
] as const;

function syncSubstituted(automation: Automation, _connector: string): unknown {
  return {
    version: automation.version,
    inputs: automation.inputs,
    nodes: automation.nodes.map((node) =>
      node.type === 'conversation.sync_mailbox'
        ? {
            ...node,
            // Provider-specific: connectorSlug + includeSent for IMAP Sent.
            input: Object.keys(node.input ?? {})
              .filter((key) => key !== 'connectorSlug' && key !== 'includeSent')
              .sort(),
          }
        : node,
    ),
    tests: (automation.tests ?? []).map((test) => ({
      name: test.name,
      input: test.input,
    })),
  };
}

describe('the three sync-emails packs stay one document', () => {
  const [canonical, ...variants] = SYNC_EMAIL_PACKS;
  const expected = syncSubstituted(
    packBySlug(canonical.slug).automation,
    canonical.connector,
  );

  for (const variant of variants) {
    it(`${variant.slug} differs from ${canonical.slug} only by provider knobs`, () => {
      expect(
        syncSubstituted(packBySlug(variant.slug).automation, variant.connector),
      ).toEqual(expected);
    });
  }

  for (const variant of SYNC_EMAIL_PACKS) {
    it(`${variant.slug} declares the inbox view and ${variant.connector}`, () => {
      const pack = packBySlug(variant.slug);
      expect(pack.manifest.builtinViews).toEqual([{ id: 'inbox' }]);
      expect(pack.manifest.requires?.connectors).toEqual(
        expect.arrayContaining([variant.connector, 'conversation']),
      );
      expect(connectorsUsedBy(pack.automation)).toEqual(['conversation']);
    });
  }
});

describe('the manifest skills declaration', () => {
  const base = { name: 'Carrier' };

  it('accepts valid skill slugs', () => {
    const parsed = automationPackManifestSchema.parse({
      ...base,
      skills: ['document-verify', 'pdf2'],
    });
    expect(parsed.skills).toEqual(['document-verify', 'pdf2']);
  });

  it('refuses a slug the skills domain would refuse', () => {
    for (const bad of ['Upper', 'double--hyphen', '-lead', 'claude']) {
      expect(
        automationPackManifestSchema.safeParse({ ...base, skills: [bad] })
          .success,
      ).toBe(false);
    }
  });

  it('refuses more skills than one package may carry', () => {
    const skills = Array.from({ length: 21 }, (_, i) => `skill-${i}`);
    expect(
      automationPackManifestSchema.safeParse({ ...base, skills }).success,
    ).toBe(false);
  });
});

describe('the manifest settings declaration', () => {
  const base = { name: 'Carrier' };
  const form = {
    file: 'validation-policy.yaml',
    title: 'Validation policy',
    fields: [
      {
        key: 'method',
        label: 'Validation profile',
        type: 'select',
        options: [{ value: 'strict_rules', label: 'Strict checklist' }],
      },
    ],
  };

  it('accepts a settings block and carries it through', () => {
    const parsed = automationPackManifestSchema.parse({
      ...base,
      settings: { folder: 'Setup', forms: [form] },
    });
    expect(parsed.settings?.forms[0]?.file).toBe('validation-policy.yaml');
  });

  it('refuses a malformed settings block at the manifest door', () => {
    expect(
      automationPackManifestSchema.safeParse({
        ...base,
        settings: { forms: [{ ...form, fields: [] }] },
      }).success,
    ).toBe(false);
  });
});
