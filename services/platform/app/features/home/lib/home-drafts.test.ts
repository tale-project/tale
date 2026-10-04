import { afterEach, describe, expect, it } from 'vitest';

import { hasDraft, homeDraftKey } from './home-drafts';

afterEach(() => {
  window.localStorage.clear();
});

describe('homeDraftKey', () => {
  it('points each kind at its own composer store', () => {
    expect(homeDraftKey({ kind: 'chat', id: 't1' }, 'u1', 'org-1')).toBe(
      'chat-draft-u1-org-1-t1',
    );
    expect(homeDraftKey({ kind: 'task', id: 'k1' }, 'u1', 'org-1')).toBe(
      'task-comment-draft-u1-org-1-k1',
    );
    expect(
      homeDraftKey({ kind: 'conversation', id: 'c1' }, 'u1', 'org-1'),
    ).toBe('conversation-u1-c1');
  });
});

describe('hasDraft', () => {
  function store(value: unknown) {
    window.localStorage.setItem('draft', JSON.stringify(value));
  }

  it.each(['chat', 'task'] as const)(
    'counts literal tag-shaped plaintext in %s drafts without changing storage',
    (kind) => {
      const key = homeDraftKey({ kind, id: 'item-1' }, 'u1', 'org-1');
      for (const text of ['<Button />', '<tag>', '<p><br></p>', '&nbsp;']) {
        const stored = JSON.stringify(text);
        window.localStorage.setItem(key, stored);
        expect(hasDraft(key, kind)).toBe(true);
        expect(window.localStorage.getItem(key)).toBe(stored);
      }
    },
  );

  it.each(['chat', 'task', 'conversation'] as const)(
    'sees ordinary unsent text but not blank text in %s drafts',
    (kind) => {
      store('Half a thought');
      expect(hasDraft('draft', kind)).toBe(true);
      for (const text of ['', '   ', '\n\t']) {
        store(text);
        expect(hasDraft('draft', kind)).toBe(false);
      }
    },
  );

  it('counts rich-editor text without changing its markup', () => {
    const text = '<p>&lt;Button /&gt;</p>';
    store(text);
    expect(hasDraft('draft', 'conversation')).toBe(true);
    expect(window.localStorage.getItem('draft')).toBe(JSON.stringify(text));
  });

  it('does not count blank text, or markup a rich field left behind', () => {
    store('   ');
    expect(hasDraft('draft', 'conversation')).toBe(false);
    store('<p><br></p>');
    expect(hasDraft('draft', 'conversation')).toBe(false);
    store('<p>&nbsp;</p>');
    expect(hasDraft('draft', 'conversation')).toBe(false);
  });

  it('reads nothing where nothing, or something unreadable, is stored', () => {
    expect(hasDraft('draft', 'conversation')).toBe(false);
    window.localStorage.setItem('draft', '{not json');
    expect(hasDraft('draft', 'conversation')).toBe(false);
  });
});
