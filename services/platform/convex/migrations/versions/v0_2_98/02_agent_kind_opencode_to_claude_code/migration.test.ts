// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_90/01_agent_kind_opencode_to_claude_code';

const LEGACY_AGENT = JSON.stringify({
  primaryBehavior: 'external-agent',
  agentKind: 'opencode',
  supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
  i18n: { en: { displayName: 'Legacy' } },
});
const CURSOR_AGENT = JSON.stringify({
  primaryBehavior: 'external-agent',
  agentKind: 'cursor',
  supportedModels: [],
  i18n: { en: { displayName: 'Cursor' } },
});

async function readAgentKind(filePath: string): Promise<string | undefined> {
  const raw = await readFileSafe(filePath);
  if (raw === null) throw new Error(`expected agent file at ${filePath}`);
  return (JSON.parse(raw) as { agentKind?: string }).agentKind;
}

// Harness ritual: real fleet up, handler idempotency over migrated state
// (a second pass finds no opencode files), down restoring the original
// opencode bytes from the fs-tree snapshot.
defineMigrationTest({
  id: '0.2.98/02_agent_kind_opencode_to_claude_code',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const chatDir = path.join(root, orgs[0].slug, 'agents', 'chat');
    await mkdir(chatDir, { recursive: true });
    await writeFile(path.join(chatDir, 'legacy.json'), LEGACY_AGENT, 'utf8');
    await writeFile(path.join(chatDir, 'cursor.json'), CURSOR_AGENT, 'utf8');
    // org2 gets no agents dir: the empty-walk no-op path.
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const chatDir = path.join(world.configRoot, org1.slug, 'agents', 'chat');
    expect(await readAgentKind(path.join(chatDir, 'legacy.json'))).toBe(
      'claude-code',
    );
    // Files on other kinds are byte-untouched.
    expect(await readFileSafe(path.join(chatDir, 'cursor.json'))).toBe(
      CURSOR_AGENT,
    );
  },
});
