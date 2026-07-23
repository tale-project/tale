// @vitest-environment node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { parseAgentYaml } from '../../../../../lib/agents/parse';
import type { AgentDefinition } from '../../../../../lib/shared/schemas/agents';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import {
  convertAgentFiles,
  knowledgeScopeFor,
  readRetiredAgentSettings,
  slugifyAgentName,
  type RetiredAgentFile,
} from './mapping';

// World-building imports the whole convex tree; under the fully parallel
// suite the default budget flakes, and a timed-out ritual's zombie async work
// can corrupt the file's later tests.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_4_0/35_agents_json_to_slim_yaml';

function agentFile(root: string, orgSlug: string, slug: string): string {
  return path.join(root, orgSlug, 'agents', `${slug}.yml`);
}

async function readAgent(
  root: string,
  orgSlug: string,
  slug: string,
): Promise<AgentDefinition> {
  const file = agentFile(root, orgSlug, slug);
  return parseAgentYaml(await readFile(file, 'utf-8'), file);
}

async function writeJson(
  root: string,
  orgSlug: string,
  relPath: string,
  data: unknown,
): Promise<void> {
  const target = path.join(root, orgSlug, 'agents', relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

// Harness ritual: real fleet up, handler idempotency over migrated state,
// down restoring the seeded world (DB rows AND on-disk files) byte-for-byte,
// and the per-org ledger.
defineMigrationTest({
  id: '0.4.0/35_agents_json_to_slim_yaml',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // org2 has an agents directory but no agents: the per-org no-op path.
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    for (const org of orgs) {
      await mkdir(path.join(root, org.slug, 'agents'), { recursive: true });
    }
    const [org1] = orgs;

    // A folder-nested agent carrying most of what the slim format dropped.
    await writeJson(root, org1.slug, 'chat/assistant.json', {
      slug: 'assistant',
      displayName: 'Assistant',
      description: 'General help for everyday questions',
      systemInstructions: 'You are a helpful, concise assistant.',
      supportedModels: ['openrouter:anthropic/claude-opus-4.8'],
      timeoutMs: 1_200_000,
      maxSteps: 20,
      conversationStarters: ['Summarize this document'],
      skillBindings: ['pdf', 'web-research'],
      toolNames: ['rag_search', 'run_code'],
      knowledgeMode: 'tool',
      includeOrgKnowledge: true,
      webSearchMode: 'tool',
      visibleInChat: true,
      routing: { modelSelection: 'auto' },
      metadata: { autoInstall: true, labels: ['General', 'Support'] },
      i18n: {
        de: {
          displayName: 'Assistent',
          description: 'Allgemeine Hilfe',
          systemInstructions: 'Du bist ein hilfsbereiter Assistent.',
          conversationStarters: ['Fasse dieses Dokument zusammen'],
        },
      },
    });

    // A sandbox-harness agent: everything it said about execution is dropped,
    // and it never named itself at the top level.
    await writeJson(root, org1.slug, 'chat/coder.json', {
      primaryBehavior: 'external-agent',
      agentKind: 'claude-code',
      authMode: 'byo',
      supportedModels: [],
      i18n: { en: { displayName: 'Coder', systemInstructions: 'Write code.' } },
    });

    // A flat file whose name the slug shape cannot keep, plus a colliding
    // sibling — both must land on stable, distinct slugs.
    await writeJson(root, org1.slug, 'Data Analyst.json', {
      displayName: 'Data Analyst',
      systemInstructions: 'Analyse the numbers.',
    });
    await writeJson(root, org1.slug, 'data-analyst.json', {
      displayName: 'Data Analyst (v2)',
      systemInstructions: 'Analyse the numbers again.',
    });

    // Never walked: an agent owned by an automation bundle travels with it.
    const bundled = path.join(
      root,
      org1.slug,
      'automations',
      'issue-desk',
      'agents',
    );
    await mkdir(bundled, { recursive: true });
    await writeFile(
      path.join(bundled, 'reviewer.json'),
      `${JSON.stringify({ displayName: 'Reviewer' }, null, 2)}\n`,
      'utf-8',
    );
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const root = world.configRoot;

    // The directory is flat afterwards: no folders, no JSON left behind.
    expect(
      (await readdir(path.join(root, org1.slug, 'agents'))).sort(),
    ).toEqual([
      'assistant.yml',
      'coder.yml',
      'data-analyst-2.yml',
      'data-analyst.yml',
    ]);

    const assistant = await readAgent(root, org1.slug, 'assistant');
    expect(assistant.displayName).toBe('Assistant');
    expect(assistant.description).toBe('General help for everyday questions');
    expect(assistant.instructions).toBe(
      'You are a helpful, concise assistant.',
    );
    // Organization configuration had no owner, so nothing becomes private.
    expect(assistant.visibility).toBe('org');
    // Four retrieval knobs fold into one scope.
    expect(assistant.knowledge).toBe('all');
    // Skill bindings keep their meaning; catalog labels become chips.
    expect(assistant.skills).toEqual(['pdf', 'web-research']);
    expect(assistant.labels).toEqual(['General', 'Support']);
    // The tool allowlist is NOT carried — the names changed with the surface
    // that answers them — so the agent stays un-narrowed.
    expect(assistant.tools).toBeUndefined();
    // Translations survive, minus the per-locale starters.
    expect(assistant.i18n?.de).toEqual({
      displayName: 'Assistent',
      description: 'Allgemeine Hilfe',
      instructions: 'Du bist ein hilfsbereiter Assistent.',
    });

    // Everything the slim format dropped is still readable off the file.
    expect(readRetiredAgentSettings(assistant)).toEqual({
      'supported-models': ['openrouter:anthropic/claude-opus-4.8'],
      'timeout-ms': 1_200_000,
      'max-steps': 20,
      'conversation-starters': ['Summarize this document'],
      'tool-names': ['rag_search', 'run_code'],
      'knowledge-mode': 'tool',
      'web-search-mode': 'tool',
      'include-org-knowledge': true,
      'visible-in-chat': true,
      routing: { modelSelection: 'auto' },
      metadata: { autoInstall: true, labels: ['General', 'Support'] },
      'source-path': 'chat/assistant.json',
      i18n: {
        de: { 'conversation-starters': ['Fasse dieses Dokument zusammen'] },
      },
    });

    // An agent that only named itself in a locale still has a label, and its
    // execution knobs are preserved rather than dropped.
    const coder = await readAgent(root, org1.slug, 'coder');
    expect(coder.displayName).toBe('Coder');
    expect(coder.knowledge).toBe('none');
    expect(readRetiredAgentSettings(coder)).toMatchObject({
      'primary-behavior': 'external-agent',
      'agent-kind': 'claude-code',
      'auth-mode': 'byo',
    });

    // The unslugifiable name and its colliding sibling both landed, and the
    // renamed one remembers what it was called.
    const renamed = await readAgent(root, org1.slug, 'data-analyst');
    expect(renamed.displayName).toBe('Data Analyst');
    expect(readRetiredAgentSettings(renamed)).toMatchObject({
      slug: 'Data Analyst',
      'source-path': 'Data Analyst.json',
    });
    expect(
      (await readAgent(root, org1.slug, 'data-analyst-2')).displayName,
    ).toBe('Data Analyst (v2)');

    // The automation-owned agent is untouched.
    expect(
      await readdir(
        path.join(root, org1.slug, 'automations', 'issue-desk', 'agents'),
      ),
    ).toEqual(['reviewer.json']);

    // The org with no agents gains no files.
    expect(await readdir(path.join(root, org2.slug, 'agents'))).toEqual([]);
  },

  cases: {
    async 'a second conversion writes the same bytes as the first'(world) {
      const file = agentFile(world.configRoot, world.orgs[0].slug, 'assistant');
      await world.applyUpOnly();
      const first = await readFile(file, 'utf-8');

      await world.applyDownOnly();
      await world.applyUpOnly();

      expect(await readFile(file, 'utf-8')).toBe(first);
    },
  },

  unit: {
    'the four retrieval knobs fold into one scope'() {
      expect(knowledgeScopeFor({})).toBe('none');
      expect(knowledgeScopeFor({ knowledgeMode: 'off' })).toBe('none');
      expect(knowledgeScopeFor({ knowledgeMode: 'tool' })).toBe('documents');
      expect(knowledgeScopeFor({ includeOrgKnowledge: true })).toBe(
        'documents',
      );
      expect(knowledgeScopeFor({ includeTeamKnowledge: true })).toBe(
        'documents',
      );
      expect(knowledgeScopeFor({ webSearchMode: 'context' })).toBe('web');
      expect(
        knowledgeScopeFor({ knowledgeMode: 'both', webSearchMode: 'tool' }),
      ).toBe('all');
    },

    'file names reduce to usable slugs'() {
      expect(slugifyAgentName('Data Analyst')).toBe('data-analyst');
      expect(slugifyAgentName('  --Spaced  Out--  ')).toBe('spaced-out');
      expect(slugifyAgentName('code__reviewer')).toBe('code_reviewer');
      expect(slugifyAgentName('!!!')).toBe('agent');
      expect(slugifyAgentName('x'.repeat(200))).toHaveLength(64);
    },

    'an agent round-trips through the file it becomes'() {
      const file: RetiredAgentFile = {
        relPath: 'chat/writer.json',
        data: {
          slug: 'writer',
          displayName: 'Writer',
          systemInstructions: 'Write plainly.',
          supportedModels: ['openrouter:openai/gpt-5.5'],
          timeoutMs: 60_000,
          conversationStarters: ['Draft a note'],
          budget: { monthlyCents: 5000 },
        },
      };

      const [converted] = convertAgentFiles([file]);

      expect(converted.slug).toBe('writer');
      expect(converted.definition.instructions).toBe('Write plainly.');
      // Nothing the file said is missing: what the persona does not carry is
      // readable back off the converted file.
      expect(readRetiredAgentSettings(converted.definition)).toEqual({
        'supported-models': ['openrouter:openai/gpt-5.5'],
        'timeout-ms': 60_000,
        'conversation-starters': ['Draft a note'],
        budget: { monthlyCents: 5000 },
        'source-path': 'chat/writer.json',
      });
    },

    'a slug the file claims wins over the name on disk'() {
      const [converted] = convertAgentFiles([
        {
          relPath: 'chat/old-name.json',
          data: { slug: 'support_bot', displayName: 'Support' },
        },
      ]);
      expect(converted.slug).toBe('support_bot');
    },

    'the same files always convert to the same slugs'() {
      const files: RetiredAgentFile[] = [1, 2, 3].map((n) => ({
        relPath: `chat/helper-${n}.json`,
        data: { slug: 'helper', displayName: `Helper ${n}` },
      }));

      expect(convertAgentFiles(files).map((a) => a.slug)).toEqual([
        'helper',
        'helper-2',
        'helper-3',
      ]);
      // The order a directory walk returned them in must not change it.
      expect(convertAgentFiles(files.toReversed()).map((a) => a.slug)).toEqual([
        'helper',
        'helper-2',
        'helper-3',
      ]);
    },

    'a file that was never converted has no retired block'() {
      expect(
        readRetiredAgentSettings({
          name: 'writer',
          displayName: 'Writer',
          visibility: 'org',
          knowledge: 'all',
        }),
      ).toBeNull();
      expect(
        readRetiredAgentSettings({
          name: 'writer',
          displayName: 'Writer',
          visibility: 'org',
          knowledge: 'all',
          metadata: { retired: 'not an object' },
        }),
      ).toBeNull();
    },
  },
});
