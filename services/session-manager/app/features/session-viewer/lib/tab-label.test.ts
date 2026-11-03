import { describe, expect, it } from 'vitest';

import { hostOf, shownAddress, speakerOf, tabLabel } from './tab-label';

describe('hostOf', () => {
  it('takes the host of an address, with its port', () => {
    expect(hostOf('https://www.example.com/a/b?c=d')).toBe('www.example.com');
    expect(hostOf('http://localhost:3000/x')).toBe('localhost:3000');
  });

  it('takes the text itself when it has no host', () => {
    expect(hostOf('about:blank')).toBe('about:blank');
    expect(hostOf('not an address')).toBe('not an address');
    expect(hostOf('')).toBe('');
  });
});

describe('speakerOf', () => {
  it('names the host of a web page, with its port', () => {
    expect(speakerOf('https://shop.example.com/cart?x=1')).toBe(
      'shop.example.com',
    );
    expect(speakerOf('http://localhost:3000/x')).toBe('localhost:3000');
  });

  it('names nobody for what is no web page: the page has no say in what shows there', () => {
    for (const url of [
      '',
      'about:blank',
      'about:neterror?e=dnsNotFound&u=https%3A//bank.example/',
      'data:text/html,<h1>Your bank</h1>',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not an address',
    ]) {
      expect(speakerOf(url), url).toBeNull();
    }
  });
});

describe('tabLabel', () => {
  it('names a tab by its title', () => {
    expect(
      tabLabel({ title: 'Example', url: 'https://example.com/' }, 'New tab'),
    ).toBe('Example');
  });

  it('names a tab without a title by its host', () => {
    expect(
      tabLabel({ title: '', url: 'https://example.com/path' }, 'New tab'),
    ).toBe('example.com');
  });

  it('names a tab that has loaded nothing by the given words', () => {
    expect(tabLabel({ title: '', url: '' }, 'New tab')).toBe('New tab');
  });
});

describe('shownAddress', () => {
  it('shows the address of the tab', () => {
    expect(shownAddress('https://a.test/', null)).toBe('https://a.test/');
  });

  it('shows nothing without a tab', () => {
    expect(shownAddress(undefined, null)).toBe('');
  });

  it('shows what was typed while the tab still has the address it had then', () => {
    expect(
      shownAddress('https://a.test/', {
        text: 'cats',
        from: 'https://a.test/',
      }),
    ).toBe('cats');
  });

  it('shows the address of the page once it arrived', () => {
    expect(
      shownAddress('https://search.test/?q=cats', {
        text: 'cats',
        from: 'https://a.test/',
      }),
    ).toBe('https://search.test/?q=cats');
  });

  it('shows what was typed in a tab that has no address yet', () => {
    expect(shownAddress(undefined, { text: 'cats', from: undefined })).toBe(
      'cats',
    );
  });
});
