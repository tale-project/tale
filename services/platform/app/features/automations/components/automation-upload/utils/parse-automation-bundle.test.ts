import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { parseAutomationBundle } from './parse-automation-bundle';

async function makeZipFile(files: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'my-automation.zip', { type: 'application/zip' });
}

const MANIFEST = JSON.stringify({
  name: 'Inbox Automation',
  roles: { assistant: 'my-automation/helper' },
  capabilities: {
    functions: [{ path: 'conversations/queries:list', mode: 'query' }],
  },
});

const VIEW = JSON.stringify({
  id: 'inbox',
  title: 'Inbox',
  data: {
    content: [
      {
        type: 'Collection',
        props: { query: { path: 'conversations/queries:list' } },
      },
      { type: 'AgentChat', props: { role: 'assistant' } },
    ],
  },
});

/** A minimal valid bundle; `overrides` swap files to break one invariant. */
function bundle(overrides: Record<string, string> = {}): Promise<File> {
  return makeZipFile({
    'my-automation/automation.json': MANIFEST,
    'my-automation/views/inbox.json': VIEW,
    ...overrides,
  });
}

describe('parseAutomationBundle — view validation mirror', () => {
  it('accepts a bundle whose views pass every publish check', async () => {
    const res = await parseAutomationBundle(await bundle());
    expect(res.success, res.success ? '' : res.error).toBe(true);
    if (!res.success) return;
    expect(res.data.slug).toBe('my-automation');
  });

  it('rejects a view failing the strict schema, naming the file', async () => {
    const res = await parseAutomationBundle(
      await bundle({
        'my-automation/views/inbox.json': JSON.stringify({
          id: 'inbox',
          data: { content: [{ type: 'Bogus', props: {} }] },
        }),
      }),
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('views/inbox.json');
  });

  it('rejects a bound function missing from capabilities.functions', async () => {
    const res = await parseAutomationBundle(
      await bundle({
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
      }),
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('capabilities.functions');
  });

  it('rejects an AgentChat role not declared in manifest.roles', async () => {
    const res = await parseAutomationBundle(
      await bundle({
        'my-automation/views/inbox.json': JSON.stringify({
          id: 'inbox',
          title: 'Inbox',
          data: { content: [{ type: 'AgentChat', props: { role: 'boss' } }] },
        }),
      }),
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('"boss"');
  });
});
