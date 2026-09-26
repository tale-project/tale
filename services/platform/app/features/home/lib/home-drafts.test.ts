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

  it('sees unsent text', () => {
    store('Half a thought');
    expect(hasDraft('draft')).toBe(true);
  });

  it('does not count blank text, or markup a rich field left behind', () => {
    store('   ');
    expect(hasDraft('draft')).toBe(false);
    store('<p><br></p>');
    expect(hasDraft('draft')).toBe(false);
    store('<p>&nbsp;</p>');
    expect(hasDraft('draft')).toBe(false);
  });

  it('reads nothing where nothing, or something unreadable, is stored', () => {
    expect(hasDraft('draft')).toBe(false);
    window.localStorage.setItem('draft', '{not json');
    expect(hasDraft('draft')).toBe(false);
  });
});
