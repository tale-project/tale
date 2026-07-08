import { describe, expect, it } from 'vitest';

import {
  collectAgentChatRoles,
  parseAutomationView,
  viewIdFromFilename,
} from './view_parse';

const VALID_FLAT_VIEW = JSON.stringify({
  id: 'desk',
  title: '$label:automation.title',
  data: {
    content: [{ type: 'Heading', props: { text: 'Hello', level: 2 } }],
  },
});

describe('viewIdFromFilename', () => {
  it('strips the directory and the .json suffix', () => {
    expect(viewIdFromFilename('views/inbox.json')).toBe('inbox');
    expect(viewIdFromFilename('desk.json')).toBe('desk');
  });
});

describe('parseAutomationView', () => {
  it('parses a valid flat view and keeps its declared id', () => {
    const res = parseAutomationView('views/desk.json', VALID_FLAT_VIEW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.id).toBe('desk');
    expect(res.view.title).toBe('$label:automation.title');
  });

  it('defaults a missing id to the filename stem', () => {
    const res = parseAutomationView(
      'views/inbox.json',
      JSON.stringify({ data: { content: [] } }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.id).toBe('inbox');
  });

  it('rejects invalid JSON with the filename in the message', () => {
    const res = parseAutomationView('views/broken.json', '{not json');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.id).toBe('broken');
    expect(res.error.code).toBe('INVALID_VIEW');
    expect(res.error.message).toContain('views/broken.json');
  });

  it('rejects a view with neither data nor tabs', () => {
    const res = parseAutomationView(
      'views/empty.json',
      JSON.stringify({ id: 'empty', title: 'Empty' }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // The stub keeps the doc's own id — it replaces THAT view in the list.
    expect(res.id).toBe('empty');
    expect(res.error.message).toContain('data');
  });

  it('rejects an unknown block type with a path-qualified issue summary', () => {
    const res = parseAutomationView(
      'views/desk.json',
      JSON.stringify({
        id: 'desk',
        data: { content: [{ type: 'Bogus', props: {} }] },
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INVALID_VIEW');
    expect(res.error.message).toContain('views/desk.json rejected');
    expect(res.error.message).toContain('data.content.0');
  });

  it('truncates a long issue list to the first few', () => {
    // Four invalid nodes → more issues than the summary spells out.
    const res = parseAutomationView(
      'views/desk.json',
      JSON.stringify({
        id: 'desk',
        data: {
          content: [1, 2, 3, 4].map(() => ({ type: 'Bogus', props: {} })),
        },
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/\(\+\d+ more\)$/);
  });
});

describe('collectAgentChatRoles', () => {
  it('finds roles across flat data, tabs, columns and zones', () => {
    const res = parseAutomationView(
      'views/inbox.json',
      JSON.stringify({
        id: 'inbox',
        data: {
          content: [{ type: 'AgentChat', props: { role: 'root' } }],
          zones: {
            'aside:content': [{ type: 'AgentChat', props: { role: 'zoned' } }],
          },
        },
        tabs: [
          {
            id: 'open',
            label: 'Open',
            data: {
              content: [{ type: 'AgentChat', props: { role: 'tabbed' } }],
            },
          },
          {
            id: 'split',
            label: 'Split',
            layout: 'split',
            columns: [
              {
                content: [{ type: 'AgentChat', props: { role: 'columned' } }],
              },
              {
                content: [{ type: 'Heading', props: { text: 'x', level: 3 } }],
              },
            ],
          },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(collectAgentChatRoles(res.view).sort()).toEqual([
      'columned',
      'root',
      'tabbed',
      'zoned',
    ]);
  });

  it('returns nothing for a view without AgentChat blocks', () => {
    const res = parseAutomationView('views/desk.json', VALID_FLAT_VIEW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(collectAgentChatRoles(res.view)).toEqual([]);
  });
});
