import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { parseAutomationBundleZip } from './bundle_parse';

async function makeZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  return zip.generateAsync({ type: 'uint8array' });
}

const VALID_MANIFEST = JSON.stringify({
  name: 'My Private Automation',
  description: 'A private automation',
  scope: 'project',
  requires: { integrations: ['github'] },
});

const AGENT_JSON = '{"name":"Worker"}';

/** Resolve the ConvexError `code` a rejected parse threw (or undefined). */
async function codeOf(bytes: Uint8Array): Promise<string | undefined> {
  try {
    await parseAutomationBundleZip(bytes);
    return undefined;
  } catch (err) {
    return (err as { data?: { code?: string } }).data?.code;
  }
}

describe('parseAutomationBundleZip', () => {
  it('parses a valid single-folder bundle and derives the slug from the folder', async () => {
    const bytes = await makeZip({
      'my-automation/automation.json': VALID_MANIFEST,
      'my-automation/views/desk.json': '{"id":"desk","data":{"content":[]}}',
      'my-automation/scripts/run.sh': 'echo hi',
    });

    const parsed = await parseAutomationBundleZip(bytes);

    expect(parsed.slug).toBe('my-automation');
    expect(parsed.manifest.name).toBe('My Private Automation');
    expect(parsed.manifest.scope).toBe('project');
    // automation.json is always re-emitted as the first file; the two assets follow.
    expect(parsed.files[0].relPath).toBe('automation.json');
    const paths = parsed.files.map((f) => f.relPath).sort();
    expect(paths).toEqual([
      'automation.json',
      'scripts/run.sh',
      'views/desk.json',
    ]);
    expect(parsed.totalBytes).toBeGreaterThan(0);
  });

  it('accepts legacy automation.json and re-emits automation.json', async () => {
    const bytes = await makeZip({
      'my-automation/app.json': VALID_MANIFEST,
      'my-automation/views/desk.json': '{"id":"desk","data":{"content":[]}}',
    });
    const parsed = await parseAutomationBundleZip(bytes);
    expect(parsed.slug).toBe('my-automation');
    expect(parsed.files[0].relPath).toBe('automation.json');
  });

  it('strips macOS __MACOSX metadata before detecting the wrapper folder', async () => {
    const bytes = await makeZip({
      'my-automation/automation.json': VALID_MANIFEST,
      '__MACOSX/my-automation/._automation.json': 'junk',
    });
    const parsed = await parseAutomationBundleZip(bytes);
    expect(parsed.slug).toBe('my-automation');
    expect(parsed.files.map((f) => f.relPath)).toEqual(['automation.json']);
  });

  it('rejects a bundle with no single wrapper folder (manifest at root)', async () => {
    const bytes = await makeZip({ 'automation.json': VALID_MANIFEST });
    expect(await codeOf(bytes)).toBe('MISSING_WRAPPER_FOLDER');
  });

  it('rejects a wrapper folder name that is not a valid automation slug', async () => {
    const bytes = await makeZip({ 'My_App/automation.json': VALID_MANIFEST });
    expect(await codeOf(bytes)).toBe('INVALID_SLUG');
  });

  it('rejects a bundle missing automation.json at the folder root', async () => {
    const bytes = await makeZip({ 'my-automation/views/desk.json': '{}' });
    expect(await codeOf(bytes)).toBe('MISSING_MANIFEST');
  });

  it('rejects an automation.json that fails manifest validation', async () => {
    // `name` is required by automationManifestSchema; omit it.
    const bytes = await makeZip({
      'my-automation/automation.json': JSON.stringify({
        description: 'no name',
      }),
    });
    expect(await codeOf(bytes)).toBe('INVALID_MANIFEST');
  });

  it('refuses a bundle where an entry escapes the wrapper folder', async () => {
    // JSZip normalizes `my-automation/../evil.txt` to the root `evil.txt`, so the
    // bundle no longer has a single wrapper folder — refused.
    const bytes = await makeZip({
      'my-automation/automation.json': VALID_MANIFEST,
      'my-automation/../evil.txt': 'pwned',
    });
    expect(await codeOf(bytes)).toBe('MISSING_WRAPPER_FOLDER');
  });

  it('accepts an inline workflow + an agent whose file is present', async () => {
    const bytes = await makeZip({
      'my-automation/automation.json': JSON.stringify({
        name: 'My Automation',
        workflow: { name: 'Run', steps: [] },
        agents: ['worker'],
      }),
      'my-automation/agents/worker.json': AGENT_JSON,
    });
    const parsed = await parseAutomationBundleZip(bytes);
    expect(parsed.manifest.workflow?.name).toBe('Run');
  });

  it('rejects a declared agent whose file is missing from the bundle', async () => {
    const bytes = await makeZip({
      'my-automation/automation.json': JSON.stringify({
        name: 'My Automation',
        agents: ['worker'],
      }),
    });
    expect(await codeOf(bytes)).toBe('MISSING_AGENT_FILE');
  });

  it('rejects a declared skill whose SKILL.md is missing from the bundle', async () => {
    const bytes = await makeZip({
      'my-automation/automation.json': JSON.stringify({
        name: 'My Automation',
        skills: ['triage'],
      }),
    });
    expect(await codeOf(bytes)).toBe('MISSING_SKILL_FILE');
  });

  it('accepts a declared skill carried at skills/<slug>/SKILL.md', async () => {
    const bytes = await makeZip({
      'my-automation/automation.json': JSON.stringify({
        name: 'My Automation',
        skills: ['triage'],
      }),
      'my-automation/skills/triage/SKILL.md': '# Triage\n',
      'my-automation/skills/triage/scripts/run.sh': 'echo hi',
    });
    const parsed = await parseAutomationBundleZip(bytes);
    expect(parsed.manifest.skills).toEqual(['triage']);
    expect(parsed.files.map((f) => f.relPath)).toContain(
      'skills/triage/SKILL.md',
    );
  });

  it('rejects a non-zip payload', async () => {
    expect(await codeOf(new TextEncoder().encode('not a zip'))).toBe(
      'INVALID_BUNDLE',
    );
  });
});

// ---------------------------------------------------------------------------
// Publish-time view enforcement — every check discovery merely tolerates
// (error stubs) is a hard rejection here.
// ---------------------------------------------------------------------------

const V2_MANIFEST = JSON.stringify({
  name: 'Inbox Automation',
  roles: { assistant: 'my-automation/helper' },
  capabilities: {
    functions: [{ path: 'conversations/queries:list', mode: 'query' }],
  },
});

const V2_VIEW = JSON.stringify({
  id: 'inbox',
  title: 'Inbox',
  tabs: [
    {
      id: 'open',
      label: 'Open',
      layout: 'split',
      columns: [
        {
          content: [
            {
              type: 'Collection',
              props: {
                query: {
                  path: 'conversations/queries:list',
                  args: { organizationId: '$orgId' },
                },
              },
            },
          ],
        },
        { content: [{ type: 'AgentChat', props: { role: 'assistant' } }] },
      ],
    },
  ],
});

/** A minimal valid v2 bundle (allowlisted binding, declared AgentChat role);
 *  `overrides` swap individual files to break one invariant. */
function v2Bundle(overrides: Record<string, string> = {}): Promise<Uint8Array> {
  return makeZip({
    'my-automation/automation.json': V2_MANIFEST,
    'my-automation/views/inbox.json': V2_VIEW,
    ...overrides,
  });
}

describe('parseAutomationBundleZip — view documents', () => {
  it('accepts a bundle whose views parse and bind only allowlisted functions', async () => {
    const parsed = await parseAutomationBundleZip(await v2Bundle());
    expect(parsed.slug).toBe('my-automation');
    expect(parsed.files.map((f) => f.relPath)).toContain('views/inbox.json');
  });

  it('rejects a view that fails the strict schema (INVALID_VIEW, filename in message)', async () => {
    const bytes = await v2Bundle({
      'my-automation/views/inbox.json': JSON.stringify({
        id: 'inbox',
        data: { content: [{ type: 'Bogus', props: {} }] },
      }),
    });
    try {
      await parseAutomationBundleZip(bytes);
      expect.unreachable('should have thrown');
    } catch (err) {
      const data = (err as { data?: { code?: string; message?: string } }).data;
      expect(data?.code).toBe('INVALID_VIEW');
      expect(data?.message).toContain('views/inbox.json');
    }
  });

  it('rejects a view that is not valid JSON (INVALID_VIEW)', async () => {
    const bytes = await v2Bundle({ 'my-automation/views/inbox.json': '{oops' });
    expect(await codeOf(bytes)).toBe('INVALID_VIEW');
  });

  it('rejects a bound function missing from capabilities.functions (VIEW_BINDING_NOT_ALLOWED)', async () => {
    const bytes = await v2Bundle({
      'my-automation/views/inbox.json': JSON.stringify({
        id: 'inbox',
        data: {
          content: [
            {
              type: 'Collection',
              props: { query: { path: 'tasks/queries:listTasksByOrg' } },
            },
          ],
        },
      }),
    });
    expect(await codeOf(bytes)).toBe('VIEW_BINDING_NOT_ALLOWED');
  });

  it('rejects an AgentChat role not declared in manifest.roles (VIEW_ROLE_UNKNOWN)', async () => {
    const bytes = await v2Bundle({
      'my-automation/views/inbox.json': JSON.stringify({
        id: 'inbox',
        title: 'Inbox',
        data: {
          content: [{ type: 'AgentChat', props: { role: 'boss' } }],
        },
      }),
    });
    expect(await codeOf(bytes)).toBe('VIEW_ROLE_UNKNOWN');
  });

  it('accepts (and ignores) a legacy messages/ dir, even malformed JSON inside it', async () => {
    // The retired per-bundle label catalog is no longer read or validated —
    // an old package's messages/ dir is carried as an inert asset so it keeps
    // uploading; nothing parses it any more (see the file header).
    const bytes = await v2Bundle({
      'my-automation/messages/en.json': '{ "automation.title": "Inbox" }',
      'my-automation/messages/fr.json': '{oops not even valid json',
    });
    const parsed = await parseAutomationBundleZip(bytes);
    expect(parsed.slug).toBe('my-automation');
    expect(parsed.files.map((f) => f.relPath)).toEqual(
      expect.arrayContaining(['messages/en.json', 'messages/fr.json']),
    );
  });

  it('ignores nested view files discovery would never serve', async () => {
    // Discovery lists views/*.json non-recursively; a nested doc is carried
    // verbatim but not gated (nor served), so an invalid one must not reject.
    const bytes = await v2Bundle({
      'my-automation/views/nested/bad.json': '{not json',
    });
    const parsed = await parseAutomationBundleZip(bytes);
    expect(parsed.slug).toBe('my-automation');
  });
});
