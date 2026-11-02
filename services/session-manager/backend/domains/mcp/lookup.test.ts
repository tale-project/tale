import { describe, expect, it, vi } from 'vitest';

import { FakeRemote, fakeLaunchSpec } from '../../testing/fake-browser.ts';
import { sessionFixture, stubManager } from '../../testing/mcp-stub-manager.ts';
import { ATTENDED_FOR, remoteOf, sessionIdOf, webAddress } from './lookup.ts';
import { ToolError } from './tool.ts';

const sessions = [
  sessionFixture({ id: 3, name: 'shop' }),
  sessionFixture({ id: 2, name: 'Work Browser' }),
  sessionFixture({ id: 1, name: '0001' }),
];

const manager = stubManager({ listSessions: () => sessions });

describe('sessionIdOf', () => {
  it('finds a session by its name, in any case', () => {
    expect(sessionIdOf(manager, 'shop')).toBe(3);
    expect(sessionIdOf(manager, 'SHOP')).toBe(3);
    expect(sessionIdOf(manager, ' work browser ')).toBe(2);
    expect(sessionIdOf(manager, '0001')).toBe(1);
  });

  it('finds a session by its id, as a number or as text', () => {
    expect(sessionIdOf(manager, 2)).toBe(2);
    expect(sessionIdOf(manager, '2')).toBe(2);
    expect(sessionIdOf(manager, ' 3 ')).toBe(3);
  });

  describe('when a session is named like the id of another', () => {
    // Session 1 is named "2" and session 2 is named "1": a mix-up would delete
    // or type a secret into the wrong browser.
    const odd = stubManager({
      listSessions: () => [
        sessionFixture({ id: 1, name: '2' }),
        sessionFixture({ id: 2, name: '1' }),
        sessionFixture({ id: 3, name: 'third' }),
      ],
    });

    it('takes a number for an id, whatever the sessions are named', () => {
      expect(sessionIdOf(odd, 1)).toBe(1);
      expect(sessionIdOf(odd, 2)).toBe(2);
      expect(sessionIdOf(odd, 3)).toBe(3);
    });

    it('takes a text for a name first', () => {
      expect(sessionIdOf(odd, '1')).toBe(2);
      expect(sessionIdOf(odd, '2')).toBe(1);
      expect(sessionIdOf(odd, ' 1 ')).toBe(2);
      expect(sessionIdOf(odd, 'THIRD')).toBe(3);
    });

    it('takes a text of digits for an id only when no session has it for a name', () => {
      expect(sessionIdOf(odd, '3')).toBe(3);
      expect(() => sessionIdOf(odd, '4')).toThrow(ToolError);
    });

    it('does not look for the name of a number that is no id', () => {
      expect(() => sessionIdOf(odd, 4)).toThrow(
        'There is no session “4”. The sessions are: 2, 1, third.',
      );
      expect(() => sessionIdOf(odd, 0)).toThrow(ToolError);
      expect(() => sessionIdOf(odd, -1)).toThrow(ToolError);
      expect(() => sessionIdOf(odd, 1.5)).toThrow(ToolError);
    });
  });

  it('says which sessions there are when it finds none', () => {
    for (const ref of ['nope', 9, '9', '', '1.5', '-1']) {
      expect(() => sessionIdOf(manager, ref), String(ref)).toThrow(ToolError);
    }
    expect(() => sessionIdOf(manager, 'nope')).toThrow(
      'There is no session “nope”. The sessions are: shop, Work Browser, 0001.',
    );
    expect(() => sessionIdOf(manager, 9)).toThrow(
      'There is no session “9”. The sessions are: shop, Work Browser, 0001.',
    );
  });

  it('says so when there are no sessions yet', () => {
    const empty = stubManager({ listSessions: () => [] });
    expect(() => sessionIdOf(empty, 'a')).toThrow(
      'There is no session “a”. The sessions are: none yet.',
    );
  });
});

describe('remoteOf', () => {
  it('is the browser of the session, and says an assistant is at work in it', () => {
    const remote = new FakeRemote(fakeLaunchSpec());
    const remoteFor = vi.fn(() => remote);
    const found = remoteOf(
      stubManager({ listSessions: () => sessions, remote: remoteFor }),
      'shop',
    );
    expect(found).toBe(remote);
    expect(remoteFor).toHaveBeenCalledWith(3);
    expect(remote.attended).toEqual([ATTENDED_FOR]);
    expect(ATTENDED_FOR).toBeGreaterThan(60_000); // dialogs wait for the assistant a while
  });

  it('does not touch a browser when the session is unknown', () => {
    const remoteFor = vi.fn();
    expect(() =>
      remoteOf(
        stubManager({ listSessions: () => sessions, remote: remoteFor }),
        'nope',
      ),
    ).toThrow(ToolError);
    expect(remoteFor).not.toHaveBeenCalled();
  });
});

describe('webAddress', () => {
  it('is the address the text means', () => {
    expect(webAddress('https://example.com/a')).toBe('https://example.com/a');
    expect(webAddress('example.org')).toBe('https://example.org');
    expect(webAddress('localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('refuses what is no web address, and says what one looks like', () => {
    for (const text of [
      'javascript:alert(1)',
      'nonsense words',
      '',
      'ftp://x.example',
    ]) {
      expect(() => webAddress(text), text).toThrow(ToolError);
    }
    expect(() => webAddress('nonsense words')).toThrow(
      '“nonsense words” is not a web address. Use one like https://example.com.',
    );
  });
});
